import type { Vector3 } from "three";

// Anything that plays through the one decoder (decoder-lease.ts): a video
// wall, or a planet whose texture is a video. main.ts hands the decoder to
// the nearest screen in the visitor's room and takes it back on leaving.

export type ScreenMode = "poster" | "hls.js" | "native";

export interface Screen {
  /** Where it is, for "nearest": the wall's centre, the first world's centre. */
  readonly position: Vector3;
  /** "poster" until attach() hands this screen the decoder. */
  readonly mode: ScreenMode;
  /** A wall may carry sound; a planet never does. */
  readonly hasAudio: boolean;
  readonly muted: boolean;
  attach(): Promise<boolean>;
  release(): void;
  unmute(): Promise<void>;
  mute(): void;
  /** Pause or resume, when the screen has its own clock (a planet); returns whether it now plays. */
  togglePlay?(): boolean;
  /** Display modes, when the screen has several (a planet's atlases), in display order. */
  readonly atlases?: readonly string[];
  /** The mode showing now. */
  readonly atlas?: string;
  /** Switch modes, keeping the frame; resolves when the new source is asked for. */
  setAtlas?(mode: string): Promise<void>;
  /** The legend image for a mode, or null when the bundle has none. */
  legendUrl?(mode: string): string | null;
}

/** What each of spectre's atlas modes is called on a button; the bundle's `description` says the rest. */
export const ATLAS_LABELS: Readonly<Record<string, string>> = {
  beauty: "Lit",
  species: "Composition",
  temperature: "Temperature",
  pressure: "Pressure",
};
/** Display order of the modes a bundle may carry. */
export const ATLAS_ORDER = ["beauty", "species", "temperature", "pressure"] as const;

