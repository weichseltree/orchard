// Where Faye is allowed to stand.
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
