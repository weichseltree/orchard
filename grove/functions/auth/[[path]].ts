// /auth/* on Cloudflare Pages: the grove's token service. Everything is in
// ../../auth/issuer.ts; the secrets it reads are listed on `AuthEnv` there.
import { handle, type AuthEnv } from "../../auth/issuer";

export const onRequest = (context: { request: Request; env: AuthEnv }): Promise<Response> =>
  handle(context.request, context.env);
