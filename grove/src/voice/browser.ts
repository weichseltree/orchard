// The browser's half of voice: real microphone, real socket, real grant.
//
// `capture.ts` takes every browser API as an injected dependency so its timing
// can be tested in node. This is where those dependencies are actually built,
// and it is deliberately the only file in src/voice/ that names `navigator`,
// `MediaRecorder` or `WebSocket`.
//
// Nothing here holds a Deepgram key. The client asks its OWN origin for a
// short-lived token (`/voice/grant`, see grove/voice/service.ts) and opens the
// socket with that; the account key never leaves the Pages Function.

import { VoiceCapture, type CaptureDeps, type Grant, type VoiceRecorder, type VoiceSocket } from "./capture";
import { pickMimeType, voiceSupported } from "./support";

/** The grove token, as `net/auth.ts` hands one over. */
export type TokenFor = (fresh: boolean) => Promise<string | null>;

export interface VoiceConfig {
  /** Where /voice lives. Empty means this build has none, and voice is off. */
  base: string;
  token: TokenFor | undefined;
}

/** Asks our own origin for a short-lived Deepgram token. */
export async function requestGrant(config: VoiceConfig, fetcher: typeof fetch = fetch): Promise<Grant> {
  if (!config.base) throw new Error("voice is not configured in this build");
  // Not a forced refresh: a cached, still-valid token is exactly what should
  // be used here, and asking for a fresh one would raise a human check in the
  // middle of someone holding a button down.
  const token = config.token ? await config.token(false) : null;
  if (!token) throw new Error("a grove token is needed to speak");
  const response = await fetcher(`${config.base}/grant`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: "{}",
  });
  if (!response.ok) {
    // The route answers with a sentence, because a visitor reads this.
    const said = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(said?.error ?? "voice is not available right now");
  }
  return (await response.json()) as Grant;
}

export interface BrowserVoiceCallbacks {
  onUtterance: (text: string) => void;
  onCaption?: (text: string) => void;
  onError?: (message: string) => void;
}

/**
 * A capture loop wired to this browser, or null when it cannot run here.
 *
 * Returning null rather than a broken object is what lets the caller hide the
 * microphone instead of showing a control that fails when pressed.
 */
export function browserVoice(config: VoiceConfig, callbacks: BrowserVoiceCallbacks): VoiceCapture | null {
  if (!config.base || !config.token || !voiceSupported()) return null;
  const mimeType = pickMimeType();
  if (!mimeType) return null;

  const deps: CaptureDeps = {
    // Echo cancellation and noise suppression are the browser's, and they are
    // worth taking: the alternative is paying to transcribe a room's hum.
    openMicrophone: () =>
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }),
    grant: () => requestGrant(config),
    connect: (url, protocols) => new WebSocket(url, [...protocols]) as unknown as VoiceSocket,
    record: (stream) => new MediaRecorder(stream, { mimeType }) as unknown as VoiceRecorder,
    onUtterance: callbacks.onUtterance,
    onCaption: callbacks.onCaption,
    onError: callbacks.onError,
  };
  return new VoiceCapture(deps);
}
