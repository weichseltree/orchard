// The club's pulse. The architecture's light is baked (world/lightfield.ts)
// and stays baked; what moves is one gain over the club's box, and the
// colour of its own luminous fittings. With music playing the gain follows
// the low end of the stream, read from an analyser on the field's bed; with
// nothing playing the room breathes slowly on its own, so a silent club is
// never a dead one. The mapping (`pulseGain`, world/venue.ts) is pure and on
// the startup path; this analyser is loaded with the first venue exhibit.

/** The analyser's low bins are the kick and the bass: this many of a 128-bin spectrum at 48 kHz, about 0 to 375 Hz. */
const LOW_BINS = 2;

export class BeatFollower {
  readonly #analyser: AnalyserNode;
  readonly #bins: Uint8Array<ArrayBuffer>;

  constructor(context: BaseAudioContext, source: AudioNode) {
    this.#analyser = context.createAnalyser();
    this.#analyser.fftSize = 256;
    this.#analyser.smoothingTimeConstant = 0.6;
    source.connect(this.#analyser);
    this.#bins = new Uint8Array(this.#analyser.frequencyBinCount);
  }

  /** The low end's level, 0..1, this instant. */
  level(): number {
    this.#analyser.getByteFrequencyData(this.#bins);
    let sum = 0;
    for (let i = 0; i < LOW_BINS; i++) sum += this.#bins[i] ?? 0;
    return sum / (LOW_BINS * 255);
  }

  dispose(): void {
    this.#analyser.disconnect();
  }
}
