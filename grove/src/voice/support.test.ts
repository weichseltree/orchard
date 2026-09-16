import { describe, expect, it } from "vitest";
import { MIME_TYPES, pickMimeType } from "./support";

describe("pickMimeType", () => {
  it("prefers Opus where the browser has it", () => {
    expect(pickMimeType(() => true)).toBe("audio/webm;codecs=opus");
  });

  it("falls back to what Safari records", () => {
    expect(pickMimeType((type) => type === "audio/mp4")).toBe("audio/mp4");
  });

  it("is null when the browser records none of them", () => {
    expect(pickMimeType(() => false)).toBeNull();
  });

  it("survives a browser whose isTypeSupported throws", () => {
    // Older builds throw rather than returning false.
    expect(pickMimeType((type) => {
      if (type !== "audio/mp4") throw new Error("nope");
      return true;
    })).toBe("audio/mp4");
  });

  it("offers a container Deepgram can detect", () => {
    for (const type of MIME_TYPES) expect(type).toMatch(/^audio\/(webm|mp4|ogg)/);
  });
});
