import type { AmmoKind } from "./sim/types.js";
import { RECORDED } from "./lines.js";

/** Procedural foley for the theatre, plus the recorded royal voices. */
export class TheatreAudio {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private noise: AudioBuffer | undefined;
  private muted = false;
  private readonly clips = new Map<string, Promise<AudioBuffer | undefined>>();
  private readonly last = new Map<string, number>();
  private readonly base: string;

  constructor(base: string) {
    this.base = base;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Browsers require a gesture before audio can start. */
  unlock(): void {
    if (!this.context) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      this.context = new Context();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.ratio.value = 4;
      this.master.connect(compressor).connect(this.context.destination);
      const length = this.context.sampleRate;
      this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
    }
    void this.context.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.context) this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.context.currentTime, 0.05);
  }

  private ready(): { ctx: AudioContext; out: GainNode } | undefined {
    if (!this.context || !this.master || this.muted || this.context.state !== "running") return undefined;
    return { ctx: this.context, out: this.master };
  }

  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    if (now - (this.last.get(key) ?? 0) < ms) return false;
    this.last.set(key, now);
    return true;
  }

  private burst(options: { duration: number; volume: number; filter: BiquadFilterType; frequency: number; q?: number; sweepTo?: number; delay?: number }): void {
    const audio = this.ready();
    if (!audio || !this.noise) return;
    const { ctx, out } = audio;
    const start = ctx.currentTime + (options.delay ?? 0);
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = options.filter;
    filter.frequency.setValueAtTime(options.frequency, start);
    if (options.sweepTo) filter.frequency.exponentialRampToValueAtTime(options.sweepTo, start + options.duration);
    filter.Q.value = options.q ?? 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(options.volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + options.duration);
    source.connect(filter).connect(gain).connect(out);
    source.start(start, Math.random() * 0.5);
    source.stop(start + options.duration + 0.05);
  }

  private tone(frequency: number, duration: number, volume: number, type: OscillatorType = "sine", options: { to?: number; delay?: number; attack?: number } = {}): void {
    const audio = this.ready();
    if (!audio) return;
    const { ctx, out } = audio;
    const start = ctx.currentTime + (options.delay ?? 0);
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (options.to) oscillator.frequency.exponentialRampToValueAtTime(options.to, start + duration);
    const gain = ctx.createGain();
    const attack = options.attack ?? 0.005;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(out);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }

  fire(ammo: AmmoKind): void {
    if (ammo === "blunderbuss") {
      this.burst({ duration: 0.3, volume: 0.8, filter: "bandpass", frequency: 1200, q: 0.6 });
      this.burst({ duration: 0.5, volume: 0.5, filter: "lowpass", frequency: 800, sweepTo: 150 });
      this.tone(140, 0.2, 0.5, "square", { to: 60 });
      return;
    }
    if (ammo === "bomb") {
      this.tone(80, 0.35, 0.7, "sine", { to: 38 });
      this.burst({ duration: 0.3, volume: 0.6, filter: "lowpass", frequency: 700, sweepTo: 120 });
      this.burst({ duration: 1.2, volume: 0.08, filter: "highpass", frequency: 3500, delay: 0.1 });
      return;
    }
    if (ammo === "shell") {
      this.tone(90, 0.35, 0.8, "sine", { to: 40 });
      this.burst({ duration: 0.35, volume: 0.7, filter: "lowpass", frequency: 900, sweepTo: 120 });
      this.tone(1500, 1.9, 0.07, "sine", { to: 500, delay: 0.25, attack: 0.3 });
      return;
    }
    this.tone(70, 0.5, 1, "sine", { to: 32 });
    this.burst({ duration: 0.6, volume: 0.9, filter: "lowpass", frequency: 2400, sweepTo: 160 });
    this.burst({ duration: 0.08, volume: 0.5, filter: "highpass", frequency: 2500 });
    if (ammo === "chain") this.tone(300, 0.6, 0.06, "sawtooth", { to: 180, delay: 0.1 });
  }

  impact(material: string, strength: number): void {
    if (!this.throttle(`impact-${material}`, 45)) return;
    const volume = Math.min(0.7, 0.12 + strength * 0.6);
    if (material === "stone" || material === "brick") {
      this.burst({ duration: 0.18, volume, filter: "bandpass", frequency: 380 + Math.random() * 120, q: 1.4 });
      this.tone(95 + Math.random() * 20, 0.16, volume * 0.6, "triangle");
    } else if (material === "straw") {
      this.burst({ duration: 0.22, volume: volume * 0.7, filter: "lowpass", frequency: 900 });
    } else if (material === "egg") {
      this.tone(620, 0.12, volume * 0.6, "sine", { to: 480 });
      this.tone(930, 0.08, volume * 0.3, "sine");
    } else if (material === "powder") {
      this.tone(180, 0.2, volume * 0.7, "triangle", { to: 120 });
    } else if (["shot", "chain", "grape", "shell", "bomb"].includes(material)) {
      this.burst({ duration: 0.2, volume: volume * 0.8, filter: "lowpass", frequency: 500 });
      this.tone(60, 0.18, volume * 0.8, "sine", { to: 40 });
    } else {
      const pitch = 220 + Math.random() * 180;
      this.burst({ duration: 0.12, volume, filter: "bandpass", frequency: pitch * 3, q: 3 });
      this.tone(pitch, 0.1, volume * 0.5, "triangle", { to: pitch * 0.8 });
    }
  }

  explode(big: boolean): void {
    this.tone(55, big ? 1.2 : 0.8, 1, "sine", { to: 25 });
    this.burst({ duration: big ? 1.6 : 1.1, volume: 1, filter: "lowpass", frequency: 3000, sweepTo: 90 });
    this.burst({ duration: 0.12, volume: 0.6, filter: "highpass", frequency: 1800 });
  }

  crack(): void {
    this.burst({ duration: 0.09, volume: 0.9, filter: "highpass", frequency: 3000 });
    this.tone(1300, 0.06, 0.4, "square", { to: 700 });
    this.burst({ duration: 0.45, volume: 0.7, filter: "lowpass", frequency: 700, sweepTo: 120, delay: 0.05 });
    this.tone(130, 0.3, 0.5, "sine", { to: 60, delay: 0.05 });
  }

  fanfare(): void {
    const notes = [392, 494, 587, 784];
    notes.forEach((note, index) => {
      this.tone(note, 0.3, 0.18, "square", { delay: 0.9 + index * 0.13 });
      this.tone(note * 1.5, 0.3, 0.06, "triangle", { delay: 0.9 + index * 0.13 });
    });
    this.tone(784, 0.9, 0.2, "square", { delay: 0.9 + notes.length * 0.13 });
    this.tone(1175, 0.9, 0.08, "triangle", { delay: 0.9 + notes.length * 0.13 });
  }

  sadTrombone(): void {
    const notes = [294, 277, 262, 247];
    notes.forEach((note, index) => {
      const last = index === notes.length - 1;
      this.tone(note, last ? 1.1 : 0.4, 0.2, "sawtooth", { delay: index * 0.42, attack: 0.04, ...(last ? { to: note * 0.92 } : {}) });
    });
  }

  boing(): void {
    this.tone(160, 0.5, 0.35, "sine", { to: 520 });
    this.tone(320, 0.3, 0.1, "triangle", { to: 900, delay: 0.05 });
  }

  bowled(): void {
    if (!this.throttle("bowled", 150)) return;
    this.tone(420, 0.12, 0.3, "triangle", { to: 300 });
    this.tone(900, 0.5, 0.12, "sine", { to: 250, delay: 0.1 });
  }

  whoosh(): void {
    if (!this.throttle("whoosh", 400)) return;
    this.burst({ duration: 0.8, volume: 0.25, filter: "bandpass", frequency: 400, sweepTo: 1600, q: 1.5 });
  }

  creak(): void {
    for (let index = 0; index < 6; index += 1) {
      this.tone(110 + index * 12, 0.25, 0.08, "triangle", { to: 150 + index * 10, delay: index * 0.38, attack: 0.08 });
      this.burst({ duration: 0.04, volume: 0.15, filter: "bandpass", frequency: 2200, q: 4, delay: index * 0.38 + 0.2 });
    }
  }

  click(): void {
    this.tone(660, 0.05, 0.12, "triangle");
  }

  reload(): void {
    this.burst({ duration: 0.05, volume: 0.2, filter: "bandpass", frequency: 1800, q: 3 });
    this.burst({ duration: 0.05, volume: 0.2, filter: "bandpass", frequency: 1400, q: 3, delay: 0.09 });
  }

  // ---------------------------------------------------------------- new stage business

  ricochet(strength: number): void {
    if (!this.throttle("ricochet", 80)) return;
    this.tone(2400, 0.5, 0.18 * (0.5 + strength), "sine", { to: 1900 });
    this.tone(3700, 0.35, 0.08, "sine", { to: 3100 });
    this.burst({ duration: 0.06, volume: 0.4, filter: "highpass", frequency: 4000 });
  }

  ropeSnap(): void {
    if (!this.throttle("rope", 60)) return;
    this.tone(180, 0.35, 0.3, "sawtooth", { to: 60 });
    this.burst({ duration: 0.12, volume: 0.35, filter: "bandpass", frequency: 1500, q: 2 });
  }

  whirr(speed: number): void {
    if (!this.throttle("whirr", 300)) return;
    this.tone(90 + Math.abs(speed) * 60, 0.6, 0.15, "sawtooth", { to: 200 + Math.abs(speed) * 80 });
  }

  /** The music box: a tinkling nursery tune, one note per call. */
  musicBoxNote(index: number): void {
    // A little made-up nursery tune, pitched high for the comb.
    const tune = [72, 76, 76, 74, 72, 72, 76, 79, 79, 77, 76, 74, 72, 74, 76, 72];
    const note = tune[index % tune.length]!;
    const frequency = 440 * Math.pow(2, (note - 69) / 12);
    this.tone(frequency, 0.9, 0.07, "sine", { attack: 0.003 });
    this.tone(frequency * 2.01, 0.4, 0.02, "sine", { attack: 0.003 });
  }

  squeak(): void {
    if (!this.throttle("squeak", 200)) return;
    const base = 1800 + Math.random() * 600;
    this.tone(base, 0.08, 0.12, "sine", { to: base * 1.4 });
    this.tone(base * 1.2, 0.1, 0.1, "sine", { to: base * 0.9, delay: 0.1 });
  }

  scurry(): void {
    if (!this.throttle("scurry", 90)) return;
    this.burst({ duration: 0.03, volume: 0.08, filter: "highpass", frequency: 3000 });
  }

  chomp(): void {
    for (let index = 0; index < 4; index += 1) this.burst({ duration: 0.05, volume: 0.3, filter: "bandpass", frequency: 900, q: 3, delay: index * 0.12 });
  }

  moo(): void {
    this.tone(130, 1.1, 0.35, "sawtooth", { to: 105, attack: 0.15 });
    this.tone(260, 1.1, 0.08, "triangle", { to: 210, attack: 0.15 });
  }

  cuckoo(): void {
    for (let index = 0; index < 3; index += 1) {
      this.tone(784, 0.18, 0.2, "sine", { delay: index * 0.8 });
      this.tone(622, 0.3, 0.2, "sine", { delay: index * 0.8 + 0.22 });
    }
  }

  dingDong(): void {
    this.tone(880, 1.4, 0.2, "sine", { attack: 0.002 });
    this.tone(1763, 0.8, 0.06, "sine", { attack: 0.002 });
    this.tone(698, 1.6, 0.2, "sine", { delay: 0.5, attack: 0.002 });
    this.tone(1398, 0.8, 0.06, "sine", { delay: 0.5, attack: 0.002 });
    this.tone(560, 0.5, 0.15, "sawtooth", { to: 820, delay: 1.3, attack: 0.08 });
  }

  zip(): void {
    this.tone(300, 0.4, 0.15, "square", { to: 1800 });
  }

  wink(): void {
    this.tone(1200, 0.12, 0.15, "sine", { to: 2400 });
    this.tone(2400, 0.2, 0.1, "sine", { to: 1600, delay: 0.12 });
  }

  tumble(): void {
    for (let index = 0; index < 6; index += 1) {
      this.tone(160 - index * 12, 0.12, 0.18, "triangle", { delay: index * 0.22 });
      this.burst({ duration: 0.08, volume: 0.15, filter: "lowpass", frequency: 600, delay: index * 0.22 });
    }
    this.tone(1400, 0.1, 0.12, "square", { delay: 1.4 });
  }

  /** A lit fuse, fizzing. Call it every frame a bomb is live; it paces itself. */
  fizz(urgency: number): void {
    if (!this.throttle("fizz", 70 - urgency * 40)) return;
    this.burst({ duration: 0.06, volume: 0.05 + urgency * 0.05, filter: "highpass", frequency: 4200 + Math.random() * 1500 });
  }

  /** The dinner gong: a long bronze shimmer with inharmonic partials. */
  gong(): void {
    if (!this.throttle("gong", 600)) return;
    this.burst({ duration: 0.12, volume: 0.5, filter: "bandpass", frequency: 700, q: 1.5 });
    const base = 98;
    for (const [ratio, volume, length] of [[1, 0.32, 4], [1.47, 0.16, 3.4], [2.09, 0.12, 3], [2.56, 0.08, 2.4], [3.01, 0.06, 2], [4.2, 0.04, 1.5]] as const) {
      this.tone(base * ratio, length, volume, "sine", { to: base * ratio * 0.985, attack: 0.02 });
    }
    this.tone(base * 1.005, 4, 0.2, "sine", { attack: 0.3 });
  }

  /** Chain shot through a maypole: a woody crack, then the creak of it going over. */
  chop(): void {
    if (!this.throttle("chop", 120)) return;
    this.burst({ duration: 0.1, volume: 0.8, filter: "bandpass", frequency: 1100, q: 2.2 });
    this.tone(210, 0.12, 0.4, "triangle", { to: 120 });
    this.tone(95, 1.1, 0.12, "sawtooth", { to: 70, delay: 0.15, attack: 0.3 });
    this.burst({ duration: 0.5, volume: 0.12, filter: "bandpass", frequency: 2400, q: 6, delay: 0.25 });
  }

  // ---------------------------------------------------------------- the audience

  /** A crowd of voices shaped into a vowel, sliding in pitch: the house reacts. */
  private crowd(vowel: "oo" | "aa" | "ah", from: number, to: number, duration: number, volume: number, delay = 0): void {
    const audio = this.ready();
    if (!audio) return;
    const { ctx, out } = audio;
    const formants = vowel === "oo" ? [320, 800] : vowel === "aa" ? [750, 1150] : [650, 1080];
    const start = ctx.currentTime + delay;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, start);
    bus.gain.linearRampToValueAtTime(volume, start + 0.12);
    bus.gain.setValueAtTime(volume, start + duration * 0.6);
    bus.gain.exponentialRampToValueAtTime(0.001, start + duration);
    const shape = ctx.createBiquadFilter();
    shape.type = "bandpass";
    shape.frequency.value = formants[0]!;
    shape.Q.value = 3;
    const shape2 = ctx.createBiquadFilter();
    shape2.type = "bandpass";
    shape2.frequency.value = formants[1]!;
    shape2.Q.value = 4;
    shape.connect(bus);
    shape2.connect(bus);
    bus.connect(out);
    for (let voice = 0; voice < 7; voice += 1) {
      const oscillator = ctx.createOscillator();
      oscillator.type = "sawtooth";
      const detune = 0.9 + Math.random() * 0.25;
      oscillator.frequency.setValueAtTime(from * detune, start);
      oscillator.frequency.linearRampToValueAtTime(to * detune, start + duration);
      oscillator.connect(shape);
      oscillator.connect(shape2);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.05);
    }
  }

  gasp(): void {
    if (!this.throttle("gasp", 2500)) return;
    this.crowd("oo", 160, 260, 1.4, 0.35);
  }

  aww(): void {
    if (!this.throttle("aww", 2500)) return;
    this.crowd("aa", 230, 150, 1.3, 0.3);
  }

  laugh(): void {
    if (!this.throttle("laugh", 1500)) return;
    for (let index = 0; index < 5; index += 1) this.crowd("ah", 240 - index * 8, 200 - index * 8, 0.16, 0.22, index * 0.17);
  }

  applause(seconds = 2.5): void {
    for (let index = 0; index < Math.round(seconds * 45); index += 1) {
      const delay = Math.random() * seconds;
      const fade = 1 - delay / seconds;
      this.burst({ duration: 0.03, volume: 0.12 + 0.12 * fade, filter: "bandpass", frequency: 1200 + Math.random() * 1800, q: 1.2, delay });
    }
    this.crowd("aa", 250, 290, 1.2, 0.18);
  }

  /** Plays a recorded line if one exists; returns false so the caller can mime instead. */
  voice(text: string): boolean {
    const file = RECORDED[text];
    const audio = this.ready();
    if (!file || !audio) return false;
    let clip = this.clips.get(file);
    if (!clip) {
      clip = fetch(`${this.base}audio/${file}`)
        .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
        .then((data) => audio.ctx.decodeAudioData(data))
        .catch(() => undefined);
      this.clips.set(file, clip);
    }
    void clip.then((buffer) => {
      const live = this.ready();
      if (!buffer || !live) return;
      const source = live.ctx.createBufferSource();
      source.buffer = buffer;
      const gain = live.ctx.createGain();
      gain.gain.value = 1.4;
      source.connect(gain).connect(live.out);
      source.start();
    });
    return true;
  }

  /** Nonsense mumble for lines without a recording, like a puppet talking. */
  mumble(speaker: "humpty" | "queen", text: string): void {
    const syllables = Math.min(10, Math.max(2, Math.round(text.length / 7)));
    const base = speaker === "queen" ? 190 : 150;
    for (let index = 0; index < syllables; index += 1) {
      const pitch = base * (0.85 + Math.random() * 0.4);
      this.tone(pitch, 0.09, 0.07, speaker === "queen" ? "sawtooth" : "triangle", { to: pitch * (0.8 + Math.random() * 0.4), delay: index * 0.11, attack: 0.02 });
    }
  }
}
