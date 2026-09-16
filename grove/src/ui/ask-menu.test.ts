import { describe, expect, it } from "vitest";
import { intentOf } from "../faye/reply";
import { ASKS, CLOSED, STICK_PUSH, stepAsk, stickStep, type AskEvent, type AskMenuState } from "./ask-menu";

function run(events: readonly AskEvent[], from: AskMenuState = CLOSED): { state: AskMenuState; said: string[] } {
  let state = from;
  const said: string[] = [];
  for (const event of events) {
    const step = stepAsk(state, event);
    state = step.state;
    if (step.say !== null) said.push(step.say);
  }
  return { state, said };
}

describe("the asks", () => {
  it("each reaches Faye as the question it claims to be", () => {
    // She answers only when named. An entry she ignored would read as a
    // broken menu, and one she read as a different question would answer
    // something nobody asked.
    const intents = ASKS.map((ask) => intentOf(ask.text));
    expect(intents).toEqual(["running", "peer", "greeting", "help"]);
  });

  it("are short enough to read on a wrist", () => {
    for (const ask of ASKS) expect(ask.label.length).toBeLessThanOrEqual(20);
  });
});

describe("stepAsk", () => {
  it("opens at the top and sends the first ask", () => {
    expect(run(["toggle", "choose"]).said).toEqual([ASKS[0].text]);
  });

  it("steps down to a later ask", () => {
    expect(run(["toggle", "down", "choose"]).said).toEqual([ASKS[1].text]);
  });

  it("closes after sending, so one pull of the trigger is one question", () => {
    const { state } = run(["toggle", "choose"]);
    expect(state.open).toBe(false);
  });

  it("stops at the ends rather than wrapping", () => {
    // An overshoot that wraps lands on the far end of the list.
    expect(run(["toggle", "up", "up", "choose"]).said).toEqual([ASKS[0].text]);
    const last = ASKS[ASKS.length - 1]!;
    expect(run(["toggle", ...Array<AskEvent>(10).fill("down"), "choose"]).said).toEqual([last.text]);
  });

  it("reopens at the top rather than where it was left", () => {
    expect(run(["toggle", "down", "down", "toggle", "toggle", "choose"]).said).toEqual([ASKS[0].text]);
  });

  it("does nothing to a closed menu", () => {
    // In particular the trigger: with the menu closed it is play/pause, and
    // must not also send a question.
    expect(run(["choose", "down", "up"])).toEqual({ state: CLOSED, said: [] });
  });

  it("closes without sending", () => {
    expect(run(["toggle", "down", "close"])).toEqual({ state: CLOSED, said: [] });
  });
});

describe("stickStep", () => {
  it("steps once per push, not once per frame", () => {
    expect(stickStep(0, 0.9)).toBe("down");
    expect(stickStep(0.9, 0.95)).toBeNull();
    expect(stickStep(0.95, 0.1)).toBeNull();
    expect(stickStep(0.1, 0.9)).toBe("down");
  });

  it("reads WebXR's negative-up axis as up", () => {
    expect(stickStep(0, -0.9)).toBe("up");
  });

  it("ignores a thumb resting on the stick", () => {
    expect(stickStep(0, STICK_PUSH - 0.05)).toBeNull();
  });

  it("does not step when the stick swings straight across", () => {
    // From full up to full down in one frame is still one held push.
    expect(stickStep(-0.9, 0.9)).toBeNull();
  });
});
