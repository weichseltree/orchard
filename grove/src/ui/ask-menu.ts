// Asking Faye something from inside a headset (VR-PRESENCE §6, ruling 3).
//
// There is no keyboard in an immersive session and the microphone button is
// DOM, so without this a visitor in a headset can read the whole room and say
// nothing to it. A short list of asks is honest about being limited, and it
// covers most of what she can actually answer: her replies are deterministic
// and few (src/faye/reply.ts), so a menu of them is not a toy version of the
// conversation — it very nearly IS the conversation.
//
// Pure state, so the input mapping is tested without a session:
//
//   left B/Y      opens and closes the menu (buttons 0, 1 and 4 are taken)
//   right stick   up and down step the highlight (its vertical axis is unused;
//                 the horizontal scrubs the tape)
//   trigger       sends the highlighted ask and closes the menu — and while
//                 the menu is open it does NOT toggle playback, or choosing an
//                 ask would also pause the tape behind it

/**
 * What the menu offers. Each names her, because she answers only when named
 * (`intentOf`), and a menu entry she ignored would read as the menu being
 * broken. A test holds every entry to the intent it claims.
 */
export const ASKS = [
  { label: "What is running?", text: "Faye, what is running?" },
  { label: "How is the peer?", text: "Faye, how is the peer?" },
  { label: "Hello", text: "Hello Faye" },
  { label: "What can you do?", text: "Faye, help" },
] as const;

export interface AskMenuState {
  open: boolean;
  index: number;
}

export const CLOSED: AskMenuState = { open: false, index: 0 };

export type AskEvent = "toggle" | "up" | "down" | "choose" | "close";

export interface AskStep {
  state: AskMenuState;
  /** A line to say, when this event chose one. */
  say: string | null;
}

/**
 * Advances the menu by one input.
 *
 * The highlight does not wrap. On a stick, wrapping means an overshoot lands
 * on the far end of the list, which is the one mistake a menu of four can
 * make; stopping at the ends makes "push up hard" a reliable way home.
 */
export function stepAsk(state: AskMenuState, event: AskEvent): AskStep {
  switch (event) {
    case "toggle":
      // Reopening starts from the top: a menu that remembers a position
      // nobody can see is a menu that sends the wrong thing.
      return { state: state.open ? CLOSED : { open: true, index: 0 }, say: null };
    case "close":
      return { state: CLOSED, say: null };
    case "up":
      if (!state.open) return { state, say: null };
      return { state: { open: true, index: Math.max(0, state.index - 1) }, say: null };
    case "down":
      if (!state.open) return { state, say: null };
      return { state: { open: true, index: Math.min(ASKS.length - 1, state.index + 1) }, say: null };
    case "choose": {
      if (!state.open) return { state, say: null };
      const ask = ASKS[state.index];
      return { state: CLOSED, say: ask ? ask.text : null };
    }
  }
}

/**
 * A stick past this counts as a push. High on purpose: a thumb resting on the
 * stick drifts, and a menu that scrolls on its own is worse than a stiff one.
 */
export const STICK_PUSH = 0.6;

/**
 * Turns a stick's vertical axis into one step per push.
 *
 * Edge-detected: the stick must return inside the threshold before it steps
 * again, or holding it would race through four entries in four frames.
 * WebXR's y axis is negative UP, which is the opposite of what reads naturally.
 */
export function stickStep(previous: number, current: number): "up" | "down" | null {
  const was = Math.abs(previous) >= STICK_PUSH;
  if (was || Math.abs(current) < STICK_PUSH) return null;
  return current < 0 ? "up" : "down";
}
