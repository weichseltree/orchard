import { describe, expect, it } from "vitest";
import { isLoopback } from "./local";

describe("isLoopback", () => {
  it("admits this machine", () => {
    for (const uri of ["ws://127.0.0.1:3000", "ws://localhost:3000", "ws://[::1]:3000", "http://localhost"]) {
      expect(isLoopback(uri), uri).toBe(true);
    }
  });

  it("refuses maincloud, as the denylist it replaces did", () => {
    expect(isLoopback("wss://maincloud.spacetimedb.com")).toBe(false);
  });

  it("refuses the hosts a denylist would have missed", () => {
    // The reason this is an allowlist: a guard that names the one remote host
    // someone thought of waves through every other one. Faye joins as an
    // admin, which bypasses the ban check, the join throttle, the per-network
    // cap and room capacity.
    for (const uri of [
      "wss://stdb.weichseltree.com",
      "ws://10.0.0.3:3000",
      "wss://example.test/orchard",
      "ws://127.0.0.1.evil.test:3000",
      "ws://localhost.evil.test",
    ]) {
      expect(isLoopback(uri), uri).toBe(false);
    }
  });

  it("treats an unparseable URI as not local", () => {
    for (const uri of ["", "not a uri", "127.0.0.1:3000"]) {
      expect(isLoopback(uri), uri).toBe(false);
    }
  });
});
