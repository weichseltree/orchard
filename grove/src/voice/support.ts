// Can this browser record a voice at all?
//
// Deliberately IMPORT-FREE. `main.ts` must be able to ask this question to
// decide whether to show a microphone, and pulling in `browser.ts` for the
// answer would drag the capture loop, the transcript assembler and the socket
// code into the startup bundle for every visitor who never speaks. Voice is
// loaded on the first press instead; this is the part that cannot wait.

/**
 * Containers to offer the recorder, best first.
 *
 * Deepgram detects the container, so the choice is the browser's constraint
 * and not ours: Chrome and the Quest browser record WebM/Opus, Safari records
 * MP4/AAC. Opus is preferred where it exists because it is what the socket's
 * cost is quoted against.
 */
export const MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

/** The first container this browser will actually record, or null. */
export function pickMimeType(
  supported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
): string | null {
  for (const type of MIME_TYPES) {
    try {
      if (supported(type)) return type;
    } catch {
      // isTypeSupported throws on some older builds rather than returning false.
    }
  }
  return null;
}

/**
 * Whether this browser can capture voice at all.
 *
 * `isSecureContext` is checked explicitly rather than left to getUserMedia's
 * rejection: on plain http the microphone is not merely refused, it is absent,
 * and a button that explains itself beats one that fails when pressed.
 */
export function voiceSupported(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  if (!globalThis.isSecureContext) return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  if (typeof MediaRecorder === "undefined" || typeof WebSocket === "undefined") return false;
  return pickMimeType() !== null;
}
