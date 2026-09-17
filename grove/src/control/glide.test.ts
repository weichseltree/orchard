import { describe, expect, it } from "vitest";
import mansionDocument from "../world/mansion.json";
import { parseMansion } from "../world/schema";
import { BODY_RADIUS } from "../world/navigation";
import { ease, floorHit, glideSeconds, planGlide, roomUnder, stepGlide, wrap, type Glide } from "./glide";
import { createBody, settle } from "./locomotion";

const mansion = parseMansion(mansionDocument);

function glideAll(body: ReturnType<typeof createBody>, glide: Glide, locked?: (id: string) => boolean): string {
  let state = "moving";
  for (let i = 0; i < 600 && state === "moving"; i++) state = stepGlide(body, glide, 1 / 60, mansion, locked);
  return state;
}

describe("a glide target is checked the way a walk would be", () => {
  it("takes the room it is told, from low on a stair under another room's floor", () => {
    const body = createBody(17, -27, 0, "foyer");
    settle(body, mansion);
    const engine = mansion.rooms.find((r) => r.id === "world-engine")!;
    expect(roomUnder(mansion, body, 5, -27)?.id).not.toBe("world-engine");
    const glide = planGlide(mansion, body, 5, -27, undefined, undefined, engine);
    expect(typeof glide === "string" ? glide : "planned").toBe("planned");
  });

  it("glides on a floor that lies under another room's (the club under the north wing)", () => {
    const body = createBody(0, -64, 0, "club");
    body.y = -5;
    const glide = planGlide(mansion, body, 1, -66);
    if (typeof glide === "string") throw new Error(glide);
    expect(glideAll(body, glide)).toBe("arrived");
    expect(body.room).toBe("club");
    expect(roomUnder(mansion, createBody(0, -40, 0, "orangery", 1, 1.5), 0, -40)?.id).toBe("orangery");
  });

  it("plans a glide across the room and arrives on the point", () => {
    const body = createBody(0, 10, 0, "hall");
    const glide = planGlide(mansion, body, 4, -6);
    if (typeof glide === "string") throw new Error(glide);
    expect(glideAll(body, glide)).toBe("arrived");
    expect(body.x).toBeCloseTo(4);
    expect(body.z).toBeCloseTo(-6);
    expect(body.room).toBe("hall");
  });

  it("goes through an open doorway it lines up with, and hands over the room", () => {
    const body = createBody(6, -5, 0, "hall");
    const glide = planGlide(mansion, body, 16, -5);
    if (typeof glide === "string") throw new Error(glide);
    expect(glideAll(body, glide)).toBe("arrived");
    expect(body.room).toBe("einstruct");
    expect(body.crossedInto).toBe("einstruct");
  });

  it("refuses a point a straight walk would meet a wall on the way to", () => {
    const body = createBody(0, 10, 0, "hall");
    expect(planGlide(mansion, body, 16, -10)).toBe("in the way");
    // The planning walk leaves the body where it was.
    expect([body.x, body.z, body.room]).toEqual([0, 10, "hall"]);
  });

  it("refuses a room behind a closed door, a locked room, and a point with no floor", () => {
    const body = createBody(6, 7, 0, "hall");
    expect(planGlide(mansion, body, 15, 8)).toBe("out of reach");
    expect(planGlide(mansion, body, 16, -5, (id) => id === "einstruct")).toBe("locked");
    expect(planGlide(mansion, body, 300, 300)).toBe("no floor");
    // A body's width off the wall is still floor; the wall itself is not.
    expect(planGlide(mansion, body, 10 - BODY_RADIUS / 2, 0)).toBe("no floor");
  });

  it("stops a glide whose door locks under it", () => {
    const body = createBody(6, -5, 0, "hall");
    const glide = planGlide(mansion, body, 16, -5);
    if (typeof glide === "string") throw new Error(glide);
    expect(glideAll(body, glide, (id) => id === "einstruct")).toBe("blocked");
    expect(body.room).toBe("hall");
    expect(body.x).toBeLessThanOrEqual(10 - BODY_RADIUS + 1e-6);
  });

  it("turns the short way round to a framed exhibit and eases in and out", () => {
    const body = createBody(0, 0, 3, "hall");
    const glide = planGlide(mansion, body, 0, 1, undefined, { yaw: -3, pitch: 0.2 });
    if (typeof glide === "string") throw new Error(glide);
    expect(Math.abs(glide.toYaw - glide.fromYaw)).toBeLessThan(Math.PI);
    glideAll(body, glide);
    expect(wrap(body.yaw - -3)).toBeCloseTo(0);
    expect(body.pitch).toBeCloseTo(0.2);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(glideSeconds(0)).toBeGreaterThan(0.3);
    expect(glideSeconds(500)).toBeLessThanOrEqual(1.8);
  });
});

describe("floorHit", () => {
  it("finds the floor under a ray looking down, and none looking up", () => {
    const down = Math.SQRT1_2;
    const hit = floorHit(mansion, 1, [0, 1.6, 5], [0, -down, -down]);
    expect(hit?.room.id).toBe("hall");
    expect(hit?.z).toBeCloseTo(3.4);
    expect(hit?.distance).toBeCloseTo(1.6 * Math.SQRT2);
    expect(floorHit(mansion, 1, [0, 1.6, 5], [0, 0.3, -1])).toBeNull();
  });
});
