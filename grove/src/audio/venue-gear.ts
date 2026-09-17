import { SoundGate } from "./gate";
import { MicrophoneGrant } from "./microphone";

// The venue's two switches, made together and off the startup path: main.ts
// keeps only their answers (two booleans) until a door asks for them.
export interface VenueGear {
  gate: SoundGate;
  microphone: MicrophoneGrant;
}

export function createVenueGear(): VenueGear {
  return { gate: new SoundGate(), microphone: new MicrophoneGrant() };
}
