// Cloudflare Turnstile: the human check in front of the token service.
// Loaded only when a site key is configured, and only when a token is
// actually needed (once a month per visitor, or after a failed connection).
// "interaction-only" keeps it invisible unless Cloudflare wants a click; then
// its box appears at the bottom of the screen.

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TIMEOUT_MS = 60_000;

interface TurnstileApi {
  render(element: HTMLElement, options: Record<string, unknown>): string | undefined;
  remove(widgetId: string): void;
}

let loading: Promise<TurnstileApi> | null = null;

function load(): Promise<TurnstileApi> {
  const ready = (globalThis as { turnstile?: TurnstileApi }).turnstile;
  if (ready) return Promise.resolve(ready);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => {
      const api = (globalThis as { turnstile?: TurnstileApi }).turnstile;
      if (api) resolve(api);
      else reject(new Error("the human check did not load"));
    };
    script.onerror = () => {
      loading = null; // a later retry may reach it
      reject(new Error("the human check did not load"));
    };
    document.head.append(script);
  });
  return loading;
}

/** Resolves with Turnstile's answer for the token service. */
export async function humanCheck(sitekey: string, host: HTMLElement): Promise<string> {
  const api = await load();
  return new Promise<string>((resolve, reject) => {
    const box = document.createElement("div");
    box.className = "human-check";
    host.append(box);
    let widget: string | undefined;
    let settled = false;
    const finish = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        if (widget) api.remove(widget);
      } catch {
        // Already gone.
      }
      box.remove();
      outcome();
    };
    const timer = window.setTimeout(
      () => finish(() => reject(new Error("the human check timed out"))),
      TIMEOUT_MS,
    );
    widget = api.render(box, {
      sitekey,
      action: "grove",
      appearance: "interaction-only",
      theme: "dark",
      callback: (token: string) => finish(() => resolve(token)),
      "error-callback": () => {
        finish(() => reject(new Error("the human check failed")));
        return true; // handled: no retry loop inside the widget
      },
      "timeout-callback": () => finish(() => reject(new Error("the human check timed out"))),
      "expired-callback": () => finish(() => reject(new Error("the human check expired"))),
    });
  });
}
