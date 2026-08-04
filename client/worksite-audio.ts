import type { ActivityEvent } from "../shared/core-protocol.js";

export type RoyalSpeaker = "humpty" | "queen";

const ROYAL_CLIPS: Readonly<Record<string, string>> = {
  "I should like it noted that I remain the principal load.": "/audio/humpty-principal-load.m4a",
  "Both sides appear to be measuring me without permission.": "/audio/humpty-measuring.m4a",
  "A little less competence would be considerably soothing.": "/audio/humpty-competence.m4a",
  "Please test the brakes before introducing me to gravity.": "/audio/humpty-brakes.m4a",
  "Bring me timber, iron, and one excellent consequence.": "/audio/queen-consequence.m4a",
  "The tower has opinions. Strike them out of it.": "/audio/queen-tower-opinions.m4a",
  "Let gravity serve the crown that understands it.": "/audio/queen-gravity.m4a",
  "Again. The egg remains offensively spherical.": "/audio/queen-spherical.m4a",
};

export class WorksiteAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private active = false;
  private readonly lastCueAt = new Map<string, number>();
  private readonly clipCache = new Map<string, AudioBuffer>();
  private readonly clipLoads = new Map<string, Promise<AudioBuffer>>();
  private readonly clipSources = new Set<AudioBufferSourceNode>();

  get enabled(): boolean {
    return this.active;
  }

  async enable(): Promise<void> {
    this.context ??= new AudioContext();
    if (!this.master) {
      this.master = this.context.createGain();
      this.master.gain.value = .16;
      this.master.connect(this.context.destination);
    }
    await this.context.resume();
    this.active = true;
    this.tone(330, .12, .55, "triangle");
    window.setTimeout(() => this.tone(495, .15, .32, "sine"), 85);
    void this.preloadRoyalClips();
  }

  disable(): void {
    this.active = false;
    window.speechSynthesis?.cancel();
    for (const source of this.clipSources) source.stop();
    this.clipSources.clear();
    void this.context?.suspend();
  }

  speak(speaker: RoyalSpeaker, text: string): number {
    if (!this.active) return 0;
    const duration = Math.min(5.2, 1.1 + text.split(/\s+/).length * .31);
    const clip = ROYAL_CLIPS[text];
    if (clip) {
      if (speaker === "queen") this.queenUndertone(duration);
      void this.playClip(clip).catch(() => this.speakWithSystemVoice(speaker, text, duration));
      return duration;
    }
    this.speakWithSystemVoice(speaker, text, duration);
    return duration;
  }

  private async preloadRoyalClips(): Promise<void> {
    await Promise.all(Object.values(ROYAL_CLIPS).map(async (url) => {
      try {
        await this.loadClip(url);
      } catch {
        // The system voice remains available when a local codec is unavailable.
      }
    }));
  }

  private speakWithSystemVoice(speaker: RoyalSpeaker, text: string, duration: number): void {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
    utterance.voice = english.find((voice) => speaker === "queen"
      ? /moira|serena|victoria|tessa|karen|female/i.test(voice.name)
      : /male|daniel|alex|arthur|fred/i.test(voice.name)) ??
      english[speaker === "queen" ? 0 : 1] ?? voices[0] ?? null;
    utterance.rate = speaker === "queen" ? .76 : .86;
    utterance.pitch = speaker === "queen" ? .58 : .76;
    utterance.volume = speaker === "queen" ? .96 : .88;
    if (speaker === "queen") this.queenUndertone(duration);
    window.speechSynthesis.speak(utterance);
  }

  private async playClip(url: string): Promise<void> {
    const context = this.context;
    const master = this.master;
    if (!context || !master) throw new Error("Audio is not enabled.");
    const buffer = await this.loadClip(url);
    if (!this.active) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(master);
    source.addEventListener("ended", () => this.clipSources.delete(source), { once: true });
    this.clipSources.add(source);
    source.start();
  }

  private async loadClip(url: string): Promise<AudioBuffer> {
    const cached = this.clipCache.get(url);
    if (cached) return cached;
    const pending = this.clipLoads.get(url);
    if (pending) return pending;
    const context = this.context;
    if (!context) throw new Error("Audio is not enabled.");
    const load = fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Royal audio ${response.status}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        this.clipCache.set(url, buffer);
        return buffer;
      })
      .finally(() => this.clipLoads.delete(url));
    this.clipLoads.set(url, load);
    return load;
  }

  cue(event: ActivityEvent): void {
    if (!this.active || event.technical?.startsWith("match:speech:")) return;
    const text = `${event.text} ${event.technical ?? ""}`.toLowerCase();
    if (/crack|hard-impact|strikes the stage/.test(text)) return this.playCue("crack", () => this.crack(), 250);
    if (/impact|strik|ram|timber|push|shove/.test(text)) return this.playCue("impact", () => this.impact(8), 120);
    if (/launch|projectile|shot|sling/.test(text)) return this.playCue("launch", () => this.whoosh(), 180);
    if (/rope|line|tension|hoist|sheave|winch/.test(text)) return this.playCue("rope", () => this.creak(), 170);
    if (/connect|key |lock |fasten|hammer/.test(text)) return this.playCue("metal", () => this.hammer(), 130);
    if (/head for|approach|carry|climb|step/.test(text)) this.playCue("step", () => this.step(), 95);
  }

  private playCue(type: string, play: () => void, interval: number): void {
    const now = performance.now();
    if (now - (this.lastCueAt.get(type) ?? 0) < interval) return;
    this.lastCueAt.set(type, now);
    play();
  }

  private queenUndertone(duration: number): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const first = context.createOscillator();
    const second = context.createOscillator();
    filter.type = "lowpass";
    filter.frequency.value = 135;
    first.type = "triangle";
    first.frequency.value = 46;
    second.type = "sine";
    second.frequency.value = 69;
    second.detune.value = -11;
    gain.gain.setValueAtTime(.001, context.currentTime);
    gain.gain.linearRampToValueAtTime(.052, context.currentTime + .18);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + duration);
    first.connect(filter);
    second.connect(filter);
    filter.connect(gain).connect(master);
    first.start();
    second.start();
    first.stop(context.currentTime + duration);
    second.stop(context.currentTime + duration);
  }

  private hammer(): void {
    this.tone(720, .055, .34, "triangle");
    window.setTimeout(() => this.tone(390, .045, .16), 38);
  }

  private step(): void {
    this.tone(102, .045, .12);
  }

  private creak(): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.active) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(112, context.currentTime);
    oscillator.frequency.linearRampToValueAtTime(166, context.currentTime + .22);
    oscillator.frequency.linearRampToValueAtTime(105, context.currentTime + .5);
    gain.gain.setValueAtTime(.001, context.currentTime);
    gain.gain.linearRampToValueAtTime(.17, context.currentTime + .1);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .52);
    oscillator.connect(gain).connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + .54);
  }

  private whoosh(): void {
    this.tone(255, .19, .2);
  }

  private impact(strength: number): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.active) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.setValueAtTime(112 + strength * 3, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(42, context.currentTime + .18);
    gain.gain.setValueAtTime(Math.min(.65, .1 + strength * .025), context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .22);
    oscillator.connect(gain).connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + .23);
  }

  private crack(): void {
    this.tone(920, .055, .5, "square");
    window.setTimeout(() => this.tone(510, .08, .3, "triangle"), 45);
    window.setTimeout(() => this.impact(14), 95);
  }

  private tone(
    frequency: number,
    duration: number,
    volume: number,
    type: OscillatorType = "sine",
  ): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.active) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }
}
