import { describe, expect, it } from "vitest";
import { isNewLine, onDisconnectAction } from "./listen";

describe("isNewLine", () => {
  const joined = 1_000_000n;

  it("hears a line said after she joined", () => {
    expect(isNewLine({ sender: "visitor", atMicros: joined + 1n }, "faye", joined)).toBe(true);
  });

  it("skips the room's history that arrives with the join", () => {
    expect(isNewLine({ sender: "visitor", atMicros: joined - 1n }, "faye", joined)).toBe(false);
    expect(isNewLine({ sender: "visitor", atMicros: joined }, "faye", joined)).toBe(false);
  });

  it("hears nothing before her own row is in the view", () => {
    expect(isNewLine({ sender: "visitor", atMicros: joined + 1n }, "faye", null)).toBe(false);
  });

  it("never answers herself", () => {
    expect(isNewLine({ sender: "faye", atMicros: joined + 1n }, "faye", joined)).toBe(false);
  });
});

describe("onDisconnectAction", () => {
  it("rejects while the connection is still coming up", () => {
    expect(onDisconnectAction({ connected: false, leaving: false })).toBe("reject");
  });

  it("exits nonzero on a drop, so systemd restarts her", () => {
    expect(onDisconnectAction({ connected: true, leaving: false })).toBe("exit-failed");
  });

  it("exits cleanly when she is leaving on purpose", () => {
    expect(onDisconnectAction({ connected: true, leaving: true })).toBe("exit-ok");
  });
});
