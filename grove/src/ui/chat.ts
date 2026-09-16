import {
  CHAT_TEXT_MAX, appendLine, isSendable, maySend, outgoing, speakerOf, waitFor,
  type ChatEntry,
} from "./chat-log";

// Room chat in flat mode: a log and a line to type in (VR-PRESENCE.md §3).
//
// This is the DOM half and nothing else — what may be sent and what the log
// holds are `chat-log.ts`, so the rules are tested without a browser.
//
// NOT the answer in a headset. In an immersive session the DOM is not shown,
// so none of this is visible there; VR-PRESENCE §5 is the canvas panel that
// replaces it, and §6 is why typing in a headset waits on voice.
//
// The pointer is locked for locomotion while the visitor is walking, and a
// locked pointer cannot be typed past. So opening the line releases it, the
// same way the guide does, and `control/desktop.ts` re-locks on the next click
// in the view. Its `focusin` handler already stops the body walking while an
// input has focus, so no movement suppression is needed here.

export interface ChatPanelCallbacks {
  /** Send a line. Rejecting is normal: the module refuses a flood. */
  onSend(text: string): Promise<void>;
  /** Called when the line opens or closes, so the caller can release the pointer. */
  onFocusChange?(open: boolean): void;
}

export class ChatPanel {
  readonly root: HTMLElement;

  readonly #log: HTMLElement;
  readonly #form: HTMLFormElement;
  readonly #input: HTMLInputElement;
  readonly #send: HTMLButtonElement;
  readonly #callbacks: ChatPanelCallbacks;
  readonly #now: () => number;

  #lines: ChatEntry[] = [];
  #lastSentAt: number | null = null;
  #gapTimer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  constructor(parent: HTMLElement, callbacks: ChatPanelCallbacks, now: () => number = Date.now) {
    this.#callbacks = callbacks;
    this.#now = now;

    this.root = document.createElement("section");
    this.root.className = "chat";
    this.root.hidden = true;
    this.root.setAttribute("aria-label", "Room chat");

    this.#log = document.createElement("ol");
    this.#log.className = "chat-log";
    // A new line is announced without stealing focus from the input.
    this.#log.setAttribute("aria-live", "polite");
    this.#log.setAttribute("aria-relevant", "additions");

    this.#form = document.createElement("form");
    this.#form.className = "chat-form";
    this.#input = document.createElement("input");
    this.#input.type = "text";
    this.#input.className = "chat-input";
    this.#input.maxLength = CHAT_TEXT_MAX;
    this.#input.autocomplete = "off";
    this.#input.setAttribute("aria-label", "Say something in this room");
    this.#input.placeholder = "Say something…";
    this.#send = document.createElement("button");
    this.#send.type = "submit";
    this.#send.className = "chat-send";
    this.#send.textContent = "Say";
    this.#form.append(this.#input, this.#send);

    this.root.append(this.#log, this.#form);
    parent.append(this.root);

    this.#form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.#submit();
    });
    this.#input.addEventListener("input", () => this.#refreshSend());
    this.#input.addEventListener("keydown", (event) => {
      // Escape gives the world back without sending.
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
    });
    this.#input.addEventListener("focus", () => this.#callbacks.onFocusChange?.(true));
    this.#input.addEventListener("blur", () => this.#callbacks.onFocusChange?.(false));
    this.#refreshSend();
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** Show the panel. `focus` opens the line for typing, which releases the pointer. */
  show(focus = false): void {
    this.root.hidden = false;
    if (focus) this.#input.focus();
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Close the line and hand the world back; the panel itself stays readable. */
  close(): void {
    this.#input.blur();
  }

  /**
   * The visitor has joined a room. The module stamps its rate clock on join,
   * so the first line straight after arriving would be refused; treating the
   * join as a send is what stops that reaching them as an error.
   */
  noteJoined(): void {
    this.#lastSentAt = this.#now();
    this.#refreshSend();
  }

  /** A line said in the room. Ours comes back through the same view. */
  addLine(line: ChatEntry): void {
    if (this.#disposed) return;
    const before = this.#lines.length;
    this.#lines = appendLine(this.#lines, line);
    if (this.#lines.length === before && before > 0) return; // already held
    this.#render();
  }

  /** Something the room should read that nobody said: a refusal, a notice. */
  addSystemLine(text: string): void {
    this.addLine({ id: `system-${this.#now()}-${text.length}`, name: "", text, mine: false, at: this.#now() });
  }

  async #submit(): Promise<void> {
    const raw = this.#input.value;
    if (!isSendable(raw) || !maySend(this.#lastSentAt, this.#now())) return;
    const text = outgoing(raw);
    this.#input.value = "";
    this.#lastSentAt = this.#now();
    this.#refreshSend();
    try {
      await this.#callbacks.onSend(text);
    } catch (error) {
      // The line did not land. Give it back rather than losing what they typed.
      this.#input.value = text;
      this.#refreshSend();
      this.addSystemLine(`not sent: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * The send button is off while there is nothing to say, and while the
   * module's gap has not passed. A button that is briefly off reads as the
   * room being orderly; "slow down" in the log reads as breakage.
   */
  #refreshSend(): void {
    if (this.#disposed) return;
    const wait = waitFor(this.#lastSentAt, this.#now());
    this.#send.disabled = !isSendable(this.#input.value) || wait > 0;
    if (this.#gapTimer !== null) clearTimeout(this.#gapTimer);
    this.#gapTimer = null;
    if (wait > 0) {
      this.#gapTimer = setTimeout(() => {
        this.#gapTimer = null;
        this.#refreshSend();
      }, wait);
    }
  }

  #render(): void {
    this.#log.replaceChildren(...this.#lines.map((line) => {
      const item = document.createElement("li");
      item.className = line.mine ? "chat-line chat-mine" : "chat-line";
      if (line.name.trim()) {
        const who = document.createElement("span");
        who.className = "chat-who";
        who.textContent = speakerOf(line);
        item.append(who, document.createTextNode(line.text));
      } else {
        // A system line has no speaker and must not borrow one.
        item.classList.add("chat-system");
        item.textContent = line.text;
      }
      return item;
    }));
    this.#log.scrollTop = this.#log.scrollHeight;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#gapTimer !== null) clearTimeout(this.#gapTimer);
    this.#gapTimer = null;
    this.root.remove();
  }
}
