"""The club floor's set: an endless, seeded techno set rendered bar by bar.

The floor plays a live stream (docs/specs/CLUB.md §5), and the ruling of
2026-09-17 allows only material the venue may distribute. Until a licensed
set is dropped into the encoder's tracks directory, the floor plays THIS: a
program, not a person. Every bar is a pure function of the seed and the bar
index (plus a reverb and echo tail carried from the bar before), so a set
rendered twice is the same set, and the encoder can be restarted at any bar.

Nothing here is a claim about music. Four-on-the-floor at 124, a bass
pattern and a chord that change every eight bars, hats, a clap, a pad and
now and then an arpeggio; a breakdown every fourth section. The tone is a
design token, like the light's falloff.

    orchard stream render out.wav --bars 16 --seed 7
"""
from __future__ import annotations

import numpy as np

SR = 48_000
BPM = 124.0
STEPS = 16
"""Bars per section: the pattern, the chord and the scene change here."""
SECTION_BARS = 8
BAR_S = 60.0 / BPM * 4
BAR_N = int(round(BAR_S * SR))
STEP_N = BAR_N // STEPS
ROOT_HZ = 55.0
"""A minor pentatonic over the root, as semitones; every voice draws from it, so the set is consonant."""
PENTATONIC = (0, 3, 5, 7, 10)
"""Sections walk this progression of roots, in semitones, one root per section."""
PROGRESSION = (0, 0, 5, 3, 0, 7, 5, 3)


def _hz(semitones: float, octave: int = 0) -> float:
    return ROOT_HZ * 2.0 ** (octave + semitones / 12.0)


def _lowpass(x: np.ndarray, cutoff_hz: float, order: float = 2.0) -> np.ndarray:
    """A smooth frequency-domain lowpass over one bar; cheap and click-free at bar edges when the tail is short."""
    spectrum = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(x.shape[0], 1.0 / SR)
    gain = 1.0 / np.sqrt(1.0 + (f / max(cutoff_hz, 20.0)) ** (2 * order))
    return np.fft.irfft(spectrum * gain[:, None] if x.ndim == 2 else spectrum * gain, n=x.shape[0], axis=0)


def _highpass(x: np.ndarray, cutoff_hz: float) -> np.ndarray:
    spectrum = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(x.shape[0], 1.0 / SR)
    gain = 1.0 - 1.0 / np.sqrt(1.0 + (f / max(cutoff_hz, 20.0)) ** 4)
    return np.fft.irfft(spectrum * gain[:, None] if x.ndim == 2 else spectrum * gain, n=x.shape[0], axis=0)


def _decay(n: int, seconds: float) -> np.ndarray:
    t = np.arange(n) / SR
    return np.exp(-t / max(seconds, 1e-3))


class Scene:
    """What one section plays; drawn from the seed and the section index alone."""

    def __init__(self, seed: int, section: int):
        rng = np.random.default_rng((seed * 1_000_003 + section) & 0xFFFF_FFFF)
        self.section = section
        self.root = PROGRESSION[section % len(PROGRESSION)]
        self.breakdown = section % 4 == 3
        self.kick = not self.breakdown
        self.hats16 = bool(rng.random() < 0.55) and not self.breakdown
        self.open_hat = bool(rng.random() < 0.5)
        self.clap = not self.breakdown or rng.random() < 0.3
        self.pad = self.breakdown or rng.random() < 0.6
        self.arp = bool(rng.random() < 0.35)
        self.cutoff = float(rng.uniform(300, 1400))
        self.sweep = float(rng.uniform(-0.6, 1.2))
        # A 16-step bass pattern: the root on the downbeat, pentatonic steps elsewhere, rests between.
        degrees = rng.choice(PENTATONIC, size=STEPS)
        mask = rng.random(STEPS) < 0.55
        mask[0] = True
        degrees[0] = 0
        self.bass = [(int(d) if on else None) for d, on in zip(degrees, mask)]
        self.bass_octave = int(rng.integers(0, 2))
        self.arp_notes = [int(d) for d in rng.choice(PENTATONIC, size=4)]
        self.pad_notes = (0, 3, 7, 10) if rng.random() < 0.6 else (0, 5, 7, 12)
        self.hat_gain = float(rng.uniform(0.35, 0.6))


class SetGenerator:
    """Bars of a stereo float set in [-1, 1], shape (BAR_N, 2)."""

    def __init__(self, seed: int = 0):
        self.seed = int(seed)
        self._tail = np.zeros((BAR_N, 2), dtype=np.float64)
        self._echo = np.zeros((BAR_N, 2), dtype=np.float64)
        self._ir = self._reverb_ir()

    def _reverb_ir(self) -> np.ndarray:
        rng = np.random.default_rng(self.seed & 0xFFFF_FFFF)
        n = int(SR * 1.6)
        noise = rng.standard_normal((n, 2))
        ir = noise * _decay(n, 0.42)[:, None]
        ir = _lowpass(ir, 5000.0)
        return ir / (np.abs(ir).sum(axis=0).max() + 1e-9) * 0.9

    def scene(self, bar: int) -> Scene:
        return Scene(self.seed, bar // SECTION_BARS)

    def bar(self, index: int) -> np.ndarray:
        scene = self.scene(index)
        in_section = index % SECTION_BARS
        rng = np.random.default_rng((self.seed * 7_919 + index) & 0xFFFF_FFFF)
        t0 = index * BAR_N
        n = BAR_N
        t = (t0 + np.arange(n)) / SR
        dry = np.zeros((n, 2))
        wet = np.zeros((n, 2))
        duck = np.ones(n)

        # Kick: a pitch sweep from 150 to 48 Hz with a click, on every beat, and the duck every other voice follows.
        if scene.kick:
            for step in (0, 4, 8, 12):
                s = step * STEP_N
                m = min(int(SR * 0.42), n - s)
                tt = np.arange(m) / SR
                freq = 48.0 + 102.0 * np.exp(-tt / 0.055)
                phase = 2 * np.pi * np.cumsum(freq) / SR
                body = np.sin(phase) * np.exp(-tt / 0.19)
                click = rng.standard_normal(min(m, 240)) * np.exp(-np.arange(min(m, 240)) / 60)
                body[: click.size] += click * 0.35
                dry[s : s + m, 0] += body * 0.95
                dry[s : s + m, 1] += body * 0.95
                duck[s : s + m] *= 1.0 - 0.8 * np.exp(-tt / 0.16)

        # Clap on two and four: three flams of band-passed noise.
        if scene.clap:
            for step in (4, 12):
                for flam in range(3):
                    s = step * STEP_N + flam * 480
                    m = min(int(SR * 0.22), n - s)
                    burst = rng.standard_normal(m) * np.exp(-np.arange(m) / (SR * 0.06))
                    dry[s : s + m, 0] += burst * 0.22
                    dry[s : s + m, 1] += burst * 0.22

        # Hats: closed on the off-beats, sixteenths in the busy scenes, an open one before the four.
        steps = range(0, STEPS) if scene.hats16 else (2, 6, 10, 14)
        for step in steps:
            s = step * STEP_N
            open_hat = scene.open_hat and step == 14
            m = min(int(SR * (0.3 if open_hat else 0.06)), n - s)
            burst = rng.standard_normal(m) * np.exp(-np.arange(m) / (SR * (0.12 if open_hat else 0.018)))
            gain = scene.hat_gain * (1.0 if step % 4 == 2 else 0.6)
            pan = 0.5 + 0.2 * np.sin(step)
            dry[s : s + m, 0] += burst * gain * (1 - pan) * 0.8
            dry[s : s + m, 1] += burst * gain * pan * 0.8
        dry = _highpass(dry, 5200.0) + _lowpass(dry, 220.0)  # hats above, kick and clap body below

        # Bass: a rounded saw following the pattern, filtered by the scene's cutoff, which sweeps across the section.
        bass = np.zeros(n)
        sweep = scene.cutoff * (1.0 + scene.sweep * (in_section + np.arange(n) / n) / SECTION_BARS)
        for step, degree in enumerate(scene.bass):
            if degree is None:
                continue
            s = step * STEP_N
            m = min(STEP_N * 2, n - s)
            f = _hz(scene.root + degree, scene.bass_octave)
            tt = (t0 + s + np.arange(m)) / SR
            saw = 2.0 * ((tt * f) % 1.0) - 1.0
            sub = np.sin(2 * np.pi * f * 0.5 * tt)
            bass[s : s + m] += (0.55 * saw + 0.45 * sub) * _decay(m, 0.28) * 0.7
        bass = _lowpass(bass, float(np.mean(sweep)), order=1.5)
        dry[:, 0] += bass * duck
        dry[:, 1] += bass * duck

        # Pad: two detuned saws per chord note, filtered low, sidechained; wide by a little detune per side.
        if scene.pad:
            pad = np.zeros((n, 2))
            for degree in scene.pad_notes:
                f = _hz(scene.root + degree, 1)
                for side, detune in ((0, 0.997), (1, 1.003)):
                    ph = (t * f * detune) % 1.0
                    pad[:, side] += (2.0 * ph - 1.0) * 0.1
            level = 0.9 if scene.breakdown else 0.5
            pad = _lowpass(pad, 900.0 + 400.0 * np.sin(2 * np.pi * index / SECTION_BARS)) * level
            dry += pad * duck[:, None]
            wet += pad * 0.8

        # An arpeggio in sixteenths, square, with two echoes carried through the echo tail.
        if scene.arp:
            arp = np.zeros((n, 2))
            for step in range(STEPS):
                s = step * STEP_N
                m = min(int(SR * 0.11), n - s)
                f = _hz(scene.root + scene.arp_notes[step % 4], 3)
                tt = (t0 + s + np.arange(m)) / SR
                square = np.sign(np.sin(2 * np.pi * f * tt)) * _decay(m, 0.05) * 0.12
                arp[s : s + m, step % 2] += square
                arp[s : s + m, 1 - step % 2] += square * 0.4
            arp = _lowpass(arp, 3800.0)
            echoed = arp + self._echo
            dry += echoed * duck[:, None] * 0.9
            wet += echoed * 0.5
            # The echo tail: three sixteenths later, twice, into the next bar.
            delay = STEP_N * 3
            self._echo = np.zeros((n, 2))
            self._echo[delay:] += echoed[: n - delay] * 0.42
        else:
            self._echo = np.zeros((n, 2))

        # Reverb on the wet bus: a convolution whose tail crosses into the next bar.
        out = dry.copy()
        if np.any(wet):
            ir = self._ir
            full = np.fft.irfft(np.fft.rfft(wet, n=n + ir.shape[0], axis=0) * np.fft.rfft(ir, n=n + ir.shape[0], axis=0), n=n + ir.shape[0], axis=0)
            out += full[:n] + self._tail
            self._tail = np.zeros((n, 2))
            tail = full[n:]
            self._tail[: min(tail.shape[0], n)] += tail[:n]
        else:
            out += self._tail
            self._tail = np.zeros((n, 2))

        # Master: a soft clip and a little headroom.
        out = np.tanh(out * 1.35) * 0.85
        return out.astype(np.float32)

    def pcm16(self, index: int) -> bytes:
        """One bar as interleaved signed 16-bit little-endian stereo at 48 kHz, the encoder's input."""
        return (np.clip(self.bar(index), -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


def render_wav(path, bars: int, seed: int = 0) -> int:
    """Renders `bars` bars to a 16-bit WAV, for listening to the generator on its own. Returns the frame count."""
    import wave

    gen = SetGenerator(seed)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        for i in range(bars):
            w.writeframes(gen.pcm16(i))
    return bars * BAR_N
