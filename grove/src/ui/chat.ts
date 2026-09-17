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
  /**
   * Push-to-talk, when this build and this browser have it. Absent means no
   * microphone is shown at all -- a control that fails when pressed is worse
   * than one that was never there.
   */
  voice?: VoicePushToTalk;
  /**
   * The log changed. Pushed rather than polled so the immersive panel is not
   * re-read every frame at 72 Hz to discover that nothing was said.
   */
  onLinesChanged?(lines: readonly ChatEntry[]): void;
}

/** The half of `VoiceCapture` this panel drives (src/voice/capture.ts). */
export interface VoicePushToTalk {
  begin(): Promise<void>;
  end(): void;
  /** Takes the microphone permission early; see the note on the button below. */
  prime(): Promise<boolean>;
}

export class ChatPanel {
  readonly root: HTMLElement;

  readonly #log: HTMLElement;
  readonly #form: HTMLFormElement;
  readonly #input: HTMLInputElement;
  readonly #send: HTMLButtonElement;
  #mic: HTMLButtonElement | null = null;
  #caption: HTMLParagraphElement | null = null;
  #talking = false;
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

    // Push-to-talk, not open-mic. An always-on microphone in a shared room
    // transcribes every side conversation in the visitor's house and bills for
    // it; holding a key is also the only honest way to show someone when they
    // are being heard.
    if (callbacks.voice) {
      this.#mic = document.createElement("button");
      this.#mic.type = "button";
      this.#mic.className = "chat-mic";
      this.#mic.textContent = "Hold to talk";
      this.#mic.setAttribute("aria-label", "Hold to speak to the room");
      this.#form.append(this.#mic);
      this.#caption = document.createElement("p");
      this.#caption.className = "chat-caption";
      this.#caption.hidden = true;
      // The live caption is a running guess and changes constantly; announcing
      // every revision would make a screen reader unusable.
      this.#caption.setAttribute("aria-live", "off");
      this.root.append(this.#caption);
    }

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
    if (this.#mic) {
      // Pointer events, not mouse: this must work with a finger and a stylus.
      // `pointerleave` and `pointercancel` matter as much as `pointerup` --
      // dragging off the button or having the gesture stolen would otherwise
      // leave the microphone open with nothing on screen saying so.
      this.#mic.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        void this.#startTalking();
      });
      for (const type of ["pointerup", "pointerleave", "pointercancel"] as const) {
        this.#mic.addEventListener(type, () => this.#stopTalking());
      }
    }
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

  /** Folded away by the visitor (the phone dock's Chat tab); lines still arrive. */
  get folded(): boolean {
    return this.root.classList.contains("chat-folded");
  }

  setFolded(folded: boolean): void {
    if (folded) this.close();
    this.root.classList.toggle("chat-folded", folded);
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

  /**
   * Takes the microphone permission while the DOM is still on screen.
   *
   * This is not an optimisation. A permission prompt CANNOT be raised inside
   * an immersive session, so a visitor who enters VR without having granted
   * the microphone finds it simply dead, with no prompt and nothing to press.
   * Call this before offering the headset.
   */
  primeVoice(): Promise<boolean> {
    return this.#callbacks.voice?.prime() ?? Promise.resolve(false);
  }

  /** The live guess at what is being said. Never sent anywhere. */
  showCaption(text: string): void {
    if (!this.#caption) return;
    this.#caption.textContent = text;
    this.#caption.hidden = text.trim() === "";
  }

  /**
   * A finished utterance. It goes through the typed path on purpose, so it
   * inherits the rate limit, the clip to CHAT_TEXT_MAX and the give-it-back
   * behaviour when the module refuses -- a spoken line that vanishes is worse
   * than a typed one, because there is nothing to retype.
   */
  sayHeard(text: string): void {
    if (this.#disposed) return;
    this.showCaption("");
    if (!isSendable(text)) return;
    this.#input.value = text;
    this.#refreshSend();
    void this.#submit();
  }

  async #startTalking(): Promise<void> {
    const voice = this.#callbacks.voice;
    if (!voice || this.#talking || this.#disposed) return;
    this.#talking = true;
    this.#setMicLive(true);
    try {
      await voice.begin();
    } catch {
      this.#talking = false;
      this.#setMicLive(false);
    }
  }

  #stopTalking(): void {
    if (!this.#talking) return;
    this.#talking = false;
    this.#setMicLive(false);
    this.#callbacks.voice?.end();
  }

  #setMicLive(live: boolean): void {
    if (!this.#mic) return;
    this.#mic.classList.toggle("chat-mic-live", live);
    this.#mic.textContent = live ? "Listening…" : "Hold to talk";
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
    // The same log, for the panel a headset can actually show (ui/world-chat.ts).
    this.#callbacks.onLinesChanged?.(this.#lines);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stopTalking();
    if (this.#gapTimer !== null) clearTimeout(this.#gapTimer);
    this.#gapTimer = null;
    this.root.remove();
  }
}
