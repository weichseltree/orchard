import { describe, expect, it } from "vitest";
import { FAYE_ROOM, isFaye, namesFaye, whereIsFaye } from "./names";

const faye = { name: "Great Admin Spirit Faye", host: true };
const visitor = { name: "Tester", host: false };

describe("namesFaye", () => {
  it("hears her name in any case, and the ways a transcriber spells it", () => {
    for (const line of ["Faye, what is running?", "hey FAYE", "fay how is the peer", "hello fae"]) {
      expect(namesFaye(line), line).toBe(true);
    }
  });

  it("does not hear it inside another word", () => {
    expect(namesFaye("fayence is lovely")).toBe(false);
  });
});

describe("isFaye", () => {
  it("is a host with her name", () => {
    expect(isFaye(faye)).toBe(true);
  });

  it("is never a visitor who calls themselves Faye", () => {
    expect(isFaye({ name: "Faye", host: false })).toBe(false);
  });

  it("is not every host", () => {
    expect(isFaye({ name: "Manuel", host: true })).toBe(false);
  });
});

describe("whereIsFaye", () => {
  const ask = "Faye, what is running?";

  it("says nothing when she is in the room", () => {
    expect(whereIsFaye(ask, [visitor, faye], "gallery", "hall")).toBeNull();
  });

  it("says nothing to a line that was not for her", () => {
    expect(whereIsFaye("hello everyone", [visitor], "gallery", "hall")).toBeNull();
  });

  it("says nothing when the line never reached a room", () => {
    expect(whereIsFaye(ask, [], null, "hall")).toBeNull();
  });

  it("names the room to walk to from anywhere else", () => {
    expect(whereIsFaye(ask, [visitor], "gallery", "hall"))
      .toBe("Faye cannot hear you from here. She stands in the hall.");
  });

  it("says she is away when her own room is empty of her", () => {
    expect(whereIsFaye(ask, [visitor], FAYE_ROOM, "hall"))
      .toBe("Faye is not here right now, so nobody will answer.");
  });

  it("is not fooled by a visitor named Faye", () => {
    expect(whereIsFaye(ask, [{ name: "Faye", host: false }], "gallery", "hall")).not.toBeNull();
  });
});
