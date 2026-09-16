// /voice/* on Cloudflare Pages: the listen grant and the spoken line.
// Everything is in ../../voice/service.ts; the secrets it reads are listed on
// `VoiceEnv` there, and `DEEPGRAM_API_KEY` is set the way `AUTH_SIGNING_KEY`
// is (docs/HOSTING.md, Secrets).
//
// The caller must hold a live grove token, verified against the same key the
// token service signs with -- so someone who has not passed the human check
// cannot spend the account. `verifyLive`, not `verifyOurs`: renewal accepts a
// long-expired token and this must not.
import { handle, type VoiceEnv } from "../../voice/service";
import { verifyLive, type AuthEnv } from "../../auth/issuer";

export const onRequest = (context: {
  request: Request;
  env: VoiceEnv & AuthEnv;
}): Promise<Response> =>
  handle(context.request, context.env, {
    fetch: (input, init) => fetch(input, init),
    log: (entry) => console.error(JSON.stringify(entry)),
    verify: async (token) => (await verifyLive(context.request, context.env, token)) !== null,
  });
