// /voice/* -- the only place the Deepgram key is allowed to be.
//
// A Pages Function beside /auth, and built the same way: everything is here,
// and `functions/voice/[[path]].ts` is six lines of wiring. Plain `vite` does
// not run Functions, so voice is off under `pnpm dev` exactly as the token
// service is -- `VITE_AUTH_URL` is empty there for the same reason. To
// exercise it locally, run `wrangler pages dev`, which runs both.
//
// There is deliberately no dev-only second implementation. A local stub of a
// route whose entire job is holding a key is the thing most likely to drift
// from the real one, and the drift would be invisible until a deploy.
//
// Two routes, and they fail in different directions:
//
//   POST /voice/grant  mints a SHORT-LIVED Deepgram token so the browser can
//                      open the listen socket itself. The account key never
//                      leaves this file. A grant is a licence to spend money,
//                      so it is gated on a grove token and capped in TTL.
//   POST /voice/speak  synthesises one of Faye's lines and returns the audio.
//
// Why a grant and not a proxy: proxying the socket would keep the key here
// AND keep `connect-src 'self'`, but it puts every visitor's audio through
// the Function for the length of the utterance, and Pages Functions are the
// wrong shape for long-lived sockets. The grant costs one CSP entry
// (`connect-src wss://api.deepgram.com`) and nothing else. That entry is a
// ruling -- see docs/specs/VOICE.md -- because it is the first non-Cloudflare
// host the client is allowed to reach.

export interface VoiceEnv {
  /** The account key. Server-side only, and never returned to a client. */
  DEEPGRAM_API_KEY?: string;
  /** The grove's token service key, to verify the caller. */
  AUTH_SIGNING_KEY?: string;
}

/** Verifies the caller holds a grove token. Injected so this file has no crypto. */
export type VerifyToken = (token: string, issuer: string) => Promise<boolean>;

export interface VoiceDeps {
  fetch: typeof fetch;
  verify: VerifyToken;
  /** Server-side only; never reaches the visitor. `console.error` in the Function. */
  log?: (entry: Record<string, unknown>) => void;
  now?: () => number;
}

/**
 * How long a minted listen token lives.
 *
 * Deepgram allows up to an hour. Thirty seconds is enough to open the socket
 * and no use at all to anyone who scrapes it out of a response: the socket,
 * once open, stays open past the token's expiry, so a short TTL costs the
 * visitor nothing and costs a thief everything.
 */
export const GRANT_TTL_S = 30;

/**
 * The longest line that may be synthesised.
 *
 * Faye's replies are one line by construction (`src/faye/reply.ts`), and the
 * module clips chat at 280. This is the spend ceiling per call: without it
 * the route is an open text-to-speech account.
 */
export const SPEAK_TEXT_MAX = 280;

/** Aura-2 is the current Deepgram voice family; `thalia` is the default here. */
export const SPEAK_VOICE = "aura-2-thalia-en";

const DEEPGRAM = "https://api.deepgram.com";

/** The listen socket the client opens with a granted token. */
export const LISTEN_URL = "wss://api.deepgram.com/v1/listen";

/**
 * Query for the listen socket.
 *
 * `interim_results` gives the live caption; `endpointing` closes an utterance
 * on a pause; `utterance_end_ms` turns on the `UtteranceEnd` backstop that
 * `src/voice/transcript.ts` relies on when endpointing does not fire. Setting
 * the first without the last is the configuration in which a sentence is
 * sometimes never sent, with nothing in the log to say why.
 */
export const LISTEN_PARAMS: Readonly<Record<string, string>> = {
  model: "nova-3",
  language: "en",
  smart_format: "true",
  interim_results: "true",
  endpointing: "300",
  utterance_end_ms: "1000",
  // No `encoding`: that parameter describes RAW audio, and the browser's
  // MediaRecorder produces Opus inside a WebM container. Declaring an
  // encoding makes Deepgram read the container bytes as samples, which
  // transcribes as silence -- a failure with no error on either end.
};

export function listenUrl(params: Record<string, string> = LISTEN_PARAMS): string {
  return `${LISTEN_URL}?${new URLSearchParams(params).toString()}`;
}

/**
 * What reaches the server log when Deepgram refuses, and nothing more.
 *
 * The visitor never sees Deepgram's reply -- its `err_msg` can name the
 * account or the key's label. But hiding it everywhere made a refusal
 * undiagnosable: the first live failure was a 502 that nobody could explain
 * without reproducing the call by hand. Deepgram's `err_code` is a fixed
 * vocabulary (`FORBIDDEN`, `INVALID_AUTH`, ...), and together with the HTTP
 * status and `request_id` it is enough to know what happened, and to quote to
 * Deepgram's support. Read it with `wrangler pages deployment tail`.
 */
export async function upstreamFailure(route: string, response: Response): Promise<Record<string, unknown>> {
  let code: unknown = null;
  let requestId: unknown = null;
  try {
    const body = (await response.json()) as { err_code?: unknown; request_id?: unknown };
    code = typeof body.err_code === "string" ? body.err_code : null;
    requestId = typeof body.request_id === "string" ? body.request_id : null;
  } catch {
    // Not JSON; the status still says something.
  }
  return { voice: route, status: response.status, err_code: code, request_id: requestId };
}

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": cache },
  });
}

/** The grove token, from `Authorization: Bearer …`. */
function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1] ?? null;
}

/**
 * Handles a /voice request.
 *
 * Every failure is a JSON body with a sentence in it, because the HUD shows
 * these to a visitor and "403" is not something to read in a headset.
 */
export async function handle(request: Request, env: VoiceEnv, deps: VoiceDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/voice/, "") || "/";

  if (!env.DEEPGRAM_API_KEY) {
    // Not an error in the local grove: voice is optional, and the HUD hides
    // the microphone rather than showing a button that cannot work.
    return json({ error: "voice is not configured here" }, 503);
  }
  if (request.method !== "POST") return json({ error: "POST only" }, 405);

  // Same-origin only. A grant handed to another site is spend on our account.
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "wrong origin" }, 403);

  const token = bearer(request);
  if (!token) return json({ error: "enter the Mind Palace before speaking" }, 401);
  if (!(await deps.verify(token, url.origin))) {
    return json({ error: "your Mind Palace pass is not valid here" }, 403);
  }

  if (path === "/grant") return grant(env, deps);
  if (path === "/speak") return speak(request, env, deps);
  return json({ error: "not found" }, 404);
}

async function grant(env: VoiceEnv, deps: VoiceDeps): Promise<Response> {
  const response = await deps.fetch(`${DEEPGRAM}/v1/auth/grant`, {
    method: "POST",
    headers: {
      authorization: `Token ${env.DEEPGRAM_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: GRANT_TTL_S }),
  });
  if (!response.ok) {
    // Never pass Deepgram's body through: it can name the account. Log the
    // parts that cannot (see `upstreamFailure`).
    deps.log?.(await upstreamFailure("grant", response));
    return json({ error: "the transcriber would not answer" }, 502);
  }
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) return json({ error: "the transcriber gave no token" }, 502);
  return json(
    { token: body.access_token, expires_in: body.expires_in ?? GRANT_TTL_S, url: listenUrl() },
    200,
  );
}

async function speak(request: Request, env: VoiceEnv, deps: VoiceDeps): Promise<Response> {
  let text: string;
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return json({ error: "send JSON" }, 400);
  }
  if (text.length === 0) return json({ error: "nothing to say" }, 400);
  if (text.length > SPEAK_TEXT_MAX) return json({ error: "that is too long to say" }, 413);

  const query = new URLSearchParams({ model: SPEAK_VOICE, encoding: "linear16", sample_rate: "24000" });
  const response = await deps.fetch(`${DEEPGRAM}/v1/speak?${query.toString()}`, {
    method: "POST",
    headers: {
      authorization: `Token ${env.DEEPGRAM_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    deps.log?.(await upstreamFailure("speak", response));
    return json({ error: "the voice would not answer" }, 502);
  }

  // Her lines are deterministic and few (`src/faye/reply.ts`), so the same
  // sentence is the same audio every time and may be held for a long while.
  // The body is not content-addressed, so this is a fixed name that must be
  // revalidated -- never `immutable`, by the same rule as `public/_headers`.
  return new Response(response.body, {
    status: 200,
    headers: {
      "content-type": "audio/wav",
      "cache-control": "private, max-age=86400",
    },
  });
}
