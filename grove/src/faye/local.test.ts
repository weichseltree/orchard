import { describe, expect, it } from "vitest";
import { connectionPolicy, isLoopback, type ConnectionRequest } from "./local";

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

describe("connectionPolicy", () => {
  const base: ConnectionRequest = { uri: "wss://maincloud.spacetimedb.com", live: false, cliConfig: "", tokenFile: "", home: "/home/manuel" };
  const ask = (over: Partial<ConnectionRequest>) => connectionPolicy({ ...base, ...over });

  it("stands in the live world only when told so explicitly", () => {
    // A mistyped URI must still fail, as the allowlist made it fail before.
    expect(ask({ tokenFile: "/t" })).toMatchObject({ ok: false });
    expect(ask({ live: true, tokenFile: "/t" })).toEqual({ ok: true, token: "token-file" });
  });

  it("never carries a CLI's token into the live world", () => {
    // The maincloud CLI's token is the publisher; a long-running script must not hold it.
    expect(ask({ live: true, cliConfig: "/home/manuel/.config/spacetime/cli.toml", tokenFile: "/t" })).toMatchObject({ ok: false });
    expect(ask({ live: true, cliConfig: "/scratch/cli.toml" })).toMatchObject({ ok: false });
  });

  it("needs her own identity live", () => {
    expect(ask({ live: true })).toMatchObject({ ok: false });
  });

  it("keeps the local rule: a local cli.toml, never the maincloud one", () => {
    const local = { uri: "ws://127.0.0.1:3000" };
    expect(ask({ ...local, cliConfig: "/scratch/stdb/cli.toml" })).toEqual({ ok: true, token: "cli-config" });
    expect(ask({ ...local })).toMatchObject({ ok: false });
    expect(ask({ ...local, cliConfig: "/home/manuel/.config/spacetime/cli.toml" })).toMatchObject({ ok: false });
    expect(ask({ ...local, cliConfig: "/home/manuel/.config/spacetime/cli.toml/" })).toMatchObject({ ok: false });
  });

  it("lets a local run use a token file too", () => {
    expect(ask({ uri: "ws://localhost:3000", tokenFile: "/t" })).toEqual({ ok: true, token: "token-file" });
  });

  it("does not treat a look-alike host as local, even with --live absent", () => {
    expect(ask({ uri: "ws://127.0.0.1.evil.test:3000", cliConfig: "/scratch/cli.toml" })).toMatchObject({ ok: false });
  });
});
