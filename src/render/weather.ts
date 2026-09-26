import * as pc from "playcanvas";
import { STAGE } from "../sim/game.js";
import type { Weather } from "../sim/level.js";
import { palette, type Kit } from "./kit.js";

const V = (x = 0, y = 0, z = 0): pc.Vec3 => new pc.Vec3(x, y, z);
type RGB = [number, number, number];
type Box = { center: [number, number, number]; size: [number, number, number]; color: pc.Color };

/** How many painted bands the backdrop sky is made of (see `buildStage`). */
export const SKY_BANDS = 16;

interface Sky {
  /** Colour stops down the backdrop, by height: the painted sky. */
  stops: Array<[number, RGB]>;
  /** How brightly the painted stars show (0 hides them). */
  stars: number;
  cloud: RGB;
  key: { color: RGB; intensity: number };
  fill: RGB;
  rim: RGB;
}

const DUSK: Sky = {
  stops: [[16.5, [0.05, 0.09, 0.13]], [11, [0.08, 0.14, 0.18]], [7, [0.2, 0.21, 0.21]], [3.5, [0.46, 0.31, 0.21]], [0.5, [0.62, 0.4, 0.24]]],
  stars: 1,
  cloud: [0.5, 0.47, 0.44],
  key: { color: [1, 0.84, 0.62], intensity: 1.8 },
  fill: [0.38, 0.53, 0.64],
  rim: [0.55, 0.62, 0.85],
};

/**
 * Each verse's weather: a painted sky, the lighting to go with it, and sometimes a hand-made
 * effect (paper rain on strings, paper snow, a thunder sheet and a cut-out bolt). Look and sound
 * only: nothing here touches the simulation, so no shot flies any differently.
 */
export const SKIES: Record<Weather, Sky> = {
  dusk: DUSK,
  dawn: {
    stops: [[16.5, [0.16, 0.2, 0.34]], [11, [0.34, 0.33, 0.48]], [7, [0.66, 0.46, 0.47]], [3.5, [0.9, 0.6, 0.43]], [0.5, [0.97, 0.76, 0.48]]],
    stars: 0.25,
    cloud: [0.92, 0.72, 0.66],
    key: { color: [1, 0.8, 0.7], intensity: 1.8 },
    fill: [0.6, 0.55, 0.72],
    rim: [0.9, 0.7, 0.75],
  },
  day: {
    stops: [[16.5, [0.2, 0.4, 0.7]], [11, [0.34, 0.56, 0.8]], [7, [0.52, 0.7, 0.86]], [3.5, [0.7, 0.8, 0.88]], [0.5, [0.8, 0.86, 0.88]]],
    stars: 0,
    cloud: [0.96, 0.96, 0.97],
    key: { color: [1, 0.95, 0.84], intensity: 1.9 },
    fill: [0.55, 0.65, 0.8],
    rim: [0.7, 0.78, 0.9],
  },
  night: {
    stops: [[16.5, [0.015, 0.025, 0.06]], [11, [0.03, 0.045, 0.1]], [7, [0.055, 0.075, 0.14]], [3.5, [0.09, 0.11, 0.19]], [0.5, [0.13, 0.14, 0.23]]],
    stars: 1.3,
    cloud: [0.2, 0.22, 0.3],
    key: { color: [0.78, 0.82, 1], intensity: 1.45 },
    fill: [0.3, 0.42, 0.72],
    rim: [0.45, 0.55, 0.95],
  },
  rain: {
    stops: [[16.5, [0.12, 0.14, 0.17]], [11, [0.2, 0.23, 0.26]], [7, [0.29, 0.31, 0.33]], [3.5, [0.37, 0.38, 0.39]], [0.5, [0.43, 0.43, 0.43]]],
    stars: 0,
    cloud: [0.32, 0.33, 0.36],
    key: { color: [0.86, 0.88, 0.92], intensity: 1.55 },
    fill: [0.42, 0.52, 0.62],
    rim: [0.55, 0.6, 0.7],
  },
  storm: {
    stops: [[16.5, [0.05, 0.06, 0.07]], [11, [0.09, 0.11, 0.11]], [7, [0.15, 0.18, 0.17]], [3.5, [0.23, 0.26, 0.23]], [0.5, [0.29, 0.31, 0.27]]],
    stars: 0,
    cloud: [0.18, 0.19, 0.2],
    key: { color: [0.8, 0.85, 0.9], intensity: 1.45 },
    fill: [0.36, 0.46, 0.55],
    rim: [0.5, 0.58, 0.7],
  },
  snow: {
    stops: [[16.5, [0.3, 0.34, 0.42]], [11, [0.45, 0.49, 0.57]], [7, [0.6, 0.63, 0.69]], [3.5, [0.72, 0.74, 0.79]], [0.5, [0.82, 0.83, 0.87]]],
    stars: 0,
    cloud: [0.86, 0.87, 0.91],
    key: { color: [0.95, 0.97, 1], intensity: 1.7 },
    fill: [0.55, 0.62, 0.75],
    rim: [0.7, 0.75, 0.9],
  },
};

/** The painted sky's colour at a given height. */
function skyAt(stops: Sky["stops"], y: number): RGB {
  for (let index = 0; index < stops.length - 1; index += 1) {
    const [top, upper] = stops[index]!;
    const [bottom, lower] = stops[index + 1]!;
    if (y <= top && y >= bottom) {
      const k = (top - y) / Math.max(0.001, top - bottom);
      return [upper[0] + (lower[0] - upper[0]) * k, upper[1] + (lower[1] - upper[1]) * k, upper[2] + (lower[2] - upper[2]) * k];
    }
  }
  return y > stops[0]![0] ? stops[0]![1] : stops[stops.length - 1]![1];
}

/** Where each painted band of the backdrop sits (its middle), top to bottom. */
export function skyBandMiddles(): number[] {
  return Array.from({ length: SKY_BANDS }, (_, band) => 16.5 - (band * 16) / SKY_BANDS - 16 / SKY_BANDS / 2);
}

/** Paint the backdrop's sky bands (materials `sky-0` … `sky-15`) for a sky. */
export function paintSky(kit: Kit, sky: Sky = DUSK): void {
  skyBandMiddles().forEach((mid, band) => {
    const [r, g, b] = skyAt(sky.stops, mid);
    const material = kit.material(`sky-${band}`, new pc.Color(r, g, b), 0.02);
    material.diffuse.set(r, g, b);
    material.update();
  });
}

/** A seeded scatter, so the rain and snow look the same every time. */
function scatter(index: number, k: number): number {
  const v = Math.sin(index * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/** How tall one run of rain or snow is before it repeats (it scrolls down and wraps round). */
const DROP = 17;

export interface WeatherLights {
  key: pc.Entity;
  fill: pc.Entity;
  rim: pc.Entity;
  camera: pc.Entity;
}

/**
 * The weather over the stage. `apply` sets a verse's sky and lighting and switches on its effects;
 * `update` runs the rain and snow and, in a storm, fires the lightning (it reports when, so the
 * thunder sheet can be rattled on cue).
 */
export class WeatherRig {
  private readonly kit: Kit;
  private readonly lights: WeatherLights;
  private readonly root: pc.Entity;
  private readonly rain: pc.Entity[] = [];
  private readonly snow: pc.Entity;
  private readonly bolt: pc.Entity;
  private weather: Weather = "dusk";
  private nextFlash = 8;
  private flashAt = -99;
  private thunderAt = Infinity;

  constructor(kit: Kit, parent: pc.Entity, lights: WeatherLights) {
    this.kit = kit;
    this.lights = lights;
    this.root = kit.group("weather", parent);
    const paper = [new pc.Color(0.62, 0.7, 0.78), new pc.Color(0.72, 0.78, 0.84), new pc.Color(0.5, 0.58, 0.68)];
    // Theatre rain: strips of blue-grey paper on strings, a curtain upstage and one in each wing.
    const curtain = (name: string, along: "x" | "z", from: number, to: number, at: number): pc.Entity => {
      const parts: Box[] = [];
      const columns = Math.round(Math.abs(to - from) / 0.7);
      for (let column = 0; column <= columns; column += 1) {
        const u = from + ((to - from) * column) / columns;
        for (let drop = 0; drop < 2 * DROP; drop += 1.7) {
          const y = drop + scatter(column, drop) * 1.4;
          const color = paper[(column + Math.round(drop)) % paper.length]!;
          const size: [number, number, number] = along === "x" ? [0.025, 0.55, 0.012] : [0.012, 0.55, 0.025];
          parts.push({ center: along === "x" ? [u, y, at] : [at, y, u], size, color });
        }
      }
      const entity = kit.meshEntity(name, kit.boxes(`rain-${name}`, parts), kit.paintMaterial(0.2), this.root, false);
      return entity;
    };
    this.rain.push(curtain("rain-upstage", "x", STAGE.minX - 1, STAGE.maxX + 1, STAGE.minZ + 1.6));
    for (const side of [-1, 1]) this.rain.push(curtain(`rain-wing-${side}`, "z", STAGE.minZ + 1.6, 8, side * (STAGE.maxX - 0.8)));
    // Paper snow: white flakes over the whole stage (behind the footlights), drifting down.
    const flakes: Box[] = [];
    for (let index = 0; index < 420; index += 1) {
      const x = (scatter(index, 1) - 0.5) * (STAGE.maxX - STAGE.minX - 2);
      const y = scatter(index, 2) * 2 * DROP;
      const z = STAGE.minZ + 1 + scatter(index, 3) * 16;
      const s = 0.11 + scatter(index, 4) * 0.08;
      flakes.push({ center: [x, y, z], size: [s, s, s * 0.3], color: index % 5 ? palette.cream : new pc.Color(1, 1, 1) });
    }
    this.snow = kit.meshEntity("snow", kit.boxes("snow", flakes), kit.paintMaterial(0.3), this.root, false);
    // A gilt cut-out bolt of lightning, hung on the backdrop for the flash.
    this.bolt = kit.group("lightning", this.root, V(0, 12, STAGE.minZ + 0.2));
    const flash = kit.material("lightning", new pc.Color(1, 0.95, 0.7), 0.3, 0, { emissive: new pc.Color(1, 0.9, 0.55) });
    let x = 0;
    let y = 0;
    for (const [dx, dy] of [[0.6, -1.2], [-0.5, -0.4], [0.7, -1.3], [-0.45, -0.35], [0.8, -1.5]] as const) {
      const length = Math.hypot(dx, dy);
      kit.primitive("bolt", "box", this.bolt, V(x + dx / 2, y + dy / 2, 0), { x: 0.16, y: length, z: 0.04 }, flash, V(0, 0, (Math.atan2(dx, -dy) * 180) / Math.PI), false);
      x += dx;
      y += dy;
    }
    this.apply("dusk");
  }

  apply(weather: Weather): void {
    this.weather = weather;
    const sky = SKIES[weather];
    paintSky(this.kit, sky);
    const [tr, tg, tb] = sky.stops[0]![1];
    this.lights.camera.camera!.clearColor = new pc.Color(tr, tg, tb);
    // The painted stars fade out by day (they're one static batch, so the material does the hiding).
    const star = this.kit.material("star", new pc.Color(1, 0.95, 0.75), 0.2);
    star.opacity = Math.min(1, sky.stars);
    star.blendType = sky.stars >= 1 ? pc.BLEND_NONE : pc.BLEND_NORMAL;
    star.emissive.set(0.8 * Math.min(1.3, sky.stars), 0.72 * Math.min(1.3, sky.stars), 0.45 * Math.min(1.3, sky.stars));
    star.update();
    const cloud = this.kit.material("cloud", new pc.Color(...sky.cloud), 0.05);
    cloud.diffuse.set(...sky.cloud);
    cloud.update();
    const light = (entity: pc.Entity, color: RGB, intensity?: number): void => {
      entity.light!.color = new pc.Color(...color);
      if (intensity !== undefined) entity.light!.intensity = intensity;
    };
    light(this.lights.key, sky.key.color, sky.key.intensity);
    light(this.lights.fill, sky.fill);
    light(this.lights.rim, sky.rim);
    const wet = weather === "rain" || weather === "storm";
    for (const curtain of this.rain) curtain.enabled = wet;
    this.snow.enabled = weather === "snow";
    this.bolt.enabled = false;
    this.nextFlash = 5 + Math.random() * 5;
    this.flashAt = -99;
    this.thunderAt = Infinity;
  }

  /** Advance the weather; true once each time the thunder should sound. */
  update(now: number): boolean {
    const weather = this.weather;
    if (weather === "rain" || weather === "storm") {
      const fall = (now * (weather === "storm" ? 11 : 8)) % DROP;
      for (const curtain of this.rain) curtain.setLocalPosition(0, -fall, 0);
    }
    if (weather === "snow") {
      this.snow.setLocalPosition(Math.sin(now * 0.4) * 0.5, -((now * 0.9) % DROP), 0);
    }
    let thunder = false;
    if (weather === "storm") {
      if (now >= this.nextFlash) {
        this.flashAt = now;
        this.nextFlash = now + 7 + Math.random() * 7;
        this.thunderAt = now + 0.25 + Math.random() * 0.6;
        this.bolt.setLocalPosition((Math.random() - 0.5) * 20, 12.5 + Math.random() * 2, STAGE.minZ + 0.2);
      }
      const since = now - this.flashAt;
      // Two quick flickers, as a stagehand works the flash pan.
      const lit = (since >= 0 && since < 0.1) || (since > 0.18 && since < 0.3);
      this.bolt.enabled = since >= 0 && since < 0.45;
      this.flashSky(lit);
      if (now >= this.thunderAt) {
        this.thunderAt = Infinity;
        thunder = true;
      }
    }
    return thunder;
  }

  private flashing = false;

  private flashSky(on: boolean): void {
    if (on === this.flashing) return;
    this.flashing = on;
    for (let band = 0; band < SKY_BANDS; band += 1) {
      const material = this.kit.material(`sky-${band}`, new pc.Color(), 0.02);
      material.emissive.set(on ? 0.55 : 0, on ? 0.58 : 0, on ? 0.62 : 0);
      material.update();
    }
  }
}
