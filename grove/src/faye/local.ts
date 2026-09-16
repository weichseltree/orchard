// Where Faye is allowed to stand, and with which identity.
//
// Pure, like `events.ts` and `reply.ts`, and for the same reason: the script
// itself parses argv and exits at import, so nothing can test a rule that
// lives inside it.

/**
 * Whether a URI points at this machine and nowhere else.
 *
 * An ALLOWLIST, deliberately. This was a denylist of maincloud and
 * spacetimedb.com, which is the wrong shape for a safety guard: it caught the
 * one remote host we happened to name and waved through every other one,
 * including a self-hosted module on a custom domain. Faye joins as an admin
 * and an admin bypasses the ban check, the join throttle, the per-network cap
 * and room capacity, so "not the host I thought of" is not good enough.
 *
 * An unparseable URI is not local.
 */
export function isLoopback(uri: string): boolean {
  let host: string;
  try {
    host = new URL(uri).hostname.toLowerCase();
  } catch {
    return false;
  }
  // URL keeps the brackets on an IPv6 literal.
  const bare = host.replace(/^\[|\]$/g, "");
  return bare === "localhost" || bare === "127.0.0.1" || bare === "::1";
}

export interface ConnectionRequest {
  uri: string;
  /** `--live`: an explicit statement that this is the public world. */
  live: boolean;
  /** `--cli-config`: a CLI's cli.toml, whose token is that CLI's identity. */
  cliConfig: string;
  /** `--token-file`: Faye's OWN identity token. */
  tokenFile: string;
  /** The home directory, to recognise the maincloud CLI's config. */
  home: string;
}

export type ConnectionPolicy = { ok: true; token: "cli-config" | "token-file" } | { ok: false; reason: string };

/**
 * Whether Faye may connect as asked, and which token she connects with.
 *
 * Ruled by Manuel on 2026-09-16: Faye stands in the live world too. What stays
 * refused is every way that could happen BY ACCIDENT or with the WRONG
 * identity:
 *
 * - A non-loopback server needs `--live`. Pointing the script somewhere else
 *   by mistake still fails, exactly as the allowlist made it fail before.
 * - Live, she uses her OWN identity from `--token-file`, and never a CLI's
 *   cli.toml. The maincloud CLI's token is the publisher: it can publish and
 *   delete the module, and a long-running script holding it would be one leak
 *   away from losing the world. Her identity is made admin with `add_admin`
 *   and can be removed with `remove_admin` without touching anything else.
 * - Locally, the old rule stands: a local cli.toml, never the maincloud one.
 */
export function connectionPolicy(request: ConnectionRequest): ConnectionPolicy {
  const home = request.home.replace(/\/+$/, "");
  const maincloudCli = request.cliConfig !== "" &&
    request.cliConfig.replace(/\/+$/, "") === `${home}/.config/spacetime/cli.toml`;

  if (isLoopback(request.uri)) {
    if (request.tokenFile) return { ok: true, token: "token-file" };
    if (!request.cliConfig) {
      return { ok: false, reason: "--cli-config is required locally: the LOCAL cli.toml whose token init made admin" };
    }
    if (maincloudCli) {
      return { ok: false, reason: "never ~/.config/spacetime/cli.toml -- that token is maincloud's publisher" };
    }
    return { ok: true, token: "cli-config" };
  }

  if (!request.live) {
    return { ok: false, reason: `${request.uri} is not this machine: pass --live to stand in the public world` };
  }
  if (request.cliConfig) {
    return { ok: false, reason: "live, Faye uses her own identity (--token-file), never a CLI's token" };
  }
  if (!request.tokenFile) {
    return { ok: false, reason: "--token-file is required live: Faye's own identity, made admin with add_admin" };
  }
  return { ok: true, token: "token-file" };
}
