import * as pc from "playcanvas";

export type Primitive = "box" | "sphere" | "cylinder" | "capsule" | "cone" | "plane";

/** The toy-armoury palette, kept from the original siege theatre. */
export const palette = {
  sky: new pc.Color(0.055, 0.082, 0.095),
  floor: new pc.Color(0.31, 0.255, 0.18),
  floorEdge: new pc.Color(0.17, 0.13, 0.085),
  felt: new pc.Color(0.2, 0.3, 0.16),
  feltDark: new pc.Color(0.14, 0.22, 0.12),
  stone: new pc.Color(0.39, 0.38, 0.335),
  stoneAlt: new pc.Color(0.44, 0.415, 0.35),
  mortar: new pc.Color(0.19, 0.205, 0.195),
  brick: new pc.Color(0.46, 0.2, 0.13),
  oak: new pc.Color(0.49, 0.285, 0.105),
  oakLight: new pc.Color(0.68, 0.455, 0.22),
  oakDark: new pc.Color(0.265, 0.135, 0.05),
  iron: new pc.Color(0.105, 0.12, 0.12),
  bronze: new pc.Color(0.49, 0.31, 0.09),
  rope: new pc.Color(0.52, 0.39, 0.2),
  straw: new pc.Color(0.84, 0.69, 0.33),
  strawDark: new pc.Color(0.62, 0.47, 0.18),
  king: new pc.Color(0.62, 0.075, 0.055),
  queen: new pc.Color(0.065, 0.39, 0.31),
  gold: new pc.Color(0.94, 0.63, 0.075),
  egg: new pc.Color(0.93, 0.865, 0.69),
  yolk: new pc.Color(1, 0.66, 0.06),
  ink: new pc.Color(0.035, 0.028, 0.02),
  cream: new pc.Color(0.79, 0.73, 0.59),
  skin: new pc.Color(0.67, 0.48, 0.33),
  velvet: new pc.Color(0.42, 0.03, 0.05),
  smoke: new pc.Color(0.66, 0.64, 0.56),
  flash: new pc.Color(1, 0.48, 0.04),
};

export function hashUnit(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

/** Material cache and primitive helpers shared by every prop builder. */
export class Kit {
  readonly app: pc.Application;
  private readonly materials = new Map<string, pc.StandardMaterial>();
  private readonly meshes = new Map<string, pc.Mesh>();

  constructor(app: pc.Application) {
    this.app = app;
  }

  get device(): pc.GraphicsDevice {
    return this.app.graphicsDevice;
  }

  material(name: string, color: pc.Color, gloss = 0.25, metalness = 0, options: { emissive?: pc.Color; doubleSided?: boolean } = {}): pc.StandardMaterial {
    const existing = this.materials.get(name);
    if (existing) return existing;
    const material = new pc.StandardMaterial();
    material.name = name;
    material.diffuse = color;
    material.gloss = gloss;
    material.metalness = metalness;
    material.useMetalness = true;
    if (options.emissive) material.emissive = options.emissive;
    if (options.doubleSided) material.cull = pc.CULLFACE_NONE;
    material.update();
    this.materials.set(name, material);
    return material;
  }

  mesh(name: string, build: () => pc.Mesh): pc.Mesh {
    let mesh = this.meshes.get(name);
    if (!mesh) {
      mesh = build();
      // Shared meshes outlive the entities that use them; hold a reference so destroying
      // one prop does not free geometry the next prop will need.
      mesh.incRefCount();
      this.meshes.set(name, mesh);
    }
    return mesh;
  }

  group(name: string, parent: pc.Entity, position: pc.Vec3 = pc.Vec3.ZERO, euler: pc.Vec3 = pc.Vec3.ZERO): pc.Entity {
    const entity = new pc.Entity(name);
    entity.setLocalPosition(position);
    entity.setLocalEulerAngles(euler);
    parent.addChild(entity);
    return entity;
  }

  primitive(
    name: string,
    type: Primitive,
    parent: pc.Entity,
    position: pc.Vec3,
    scale: { x: number; y: number; z: number },
    material: pc.StandardMaterial,
    euler: pc.Vec3 = pc.Vec3.ZERO,
    castShadows = true,
  ): pc.Entity {
    const entity = new pc.Entity(name);
    entity.setLocalPosition(position);
    entity.setLocalScale(scale.x, scale.y, scale.z);
    entity.setLocalEulerAngles(euler);
    entity.addComponent("render", {
      type,
      material,
      castShadows,
      receiveShadows: true,
    });
    parent.addChild(entity);
    return entity;
  }

  meshEntity(name: string, mesh: pc.Mesh, material: pc.StandardMaterial, parent: pc.Entity, castShadows = true): pc.Entity {
    const entity = new pc.Entity(name);
    const instance = new pc.MeshInstance(mesh, material);
    instance.castShadow = castShadows;
    entity.addComponent("render", { meshInstances: [instance], castShadows, receiveShadows: true });
    parent.addChild(entity);
    return entity;
  }

  /** Torus lying in the XZ plane; `sectorAngle` (degrees) gives an open arc. */
  torus(ringRadius: number, tubeRadius: number, segments = 20, sides = 8, sectorAngle = 360): pc.Mesh {
    return this.mesh(`torus-${ringRadius}-${tubeRadius}-${segments}-${sides}-${sectorAngle}`, () =>
      pc.Mesh.fromGeometry(this.device, new pc.TorusGeometry({ ringRadius, tubeRadius, segments, sides, sectorAngle })),
    );
  }

  private build(positions: number[], indices: number[], extra: { normals?: number[]; uvs?: number[]; colors?: number[] } = {}): pc.Mesh {
    const mesh = new pc.Mesh(this.device);
    mesh.setPositions(positions);
    mesh.setNormals(extra.normals ?? pc.calculateNormals(positions, indices));
    if (extra.uvs) mesh.setUvs(0, extra.uvs);
    if (extra.colors) mesh.setColors(extra.colors, 4);
    mesh.setIndices(indices);
    mesh.update();
    return mesh;
  }

  /** One vertex-coloured material per gloss level, for baked multi-box props. */
  paintMaterial(gloss: number): pc.StandardMaterial {
    const name = `paint-${gloss.toFixed(2)}`;
    const existing = this.materials.get(name);
    if (existing) return existing;
    const material = this.material(name, new pc.Color(1, 1, 1), gloss);
    material.diffuseVertexColor = true;
    material.update();
    return material;
  }

  /** Several coloured boxes baked into one mesh: one draw call instead of many. */
  boxes(name: string, parts: ReadonlyArray<{ center: readonly [number, number, number]; size: readonly [number, number, number]; color: pc.Color }>): pc.Mesh {
    return this.mesh(name, () => {
      const positions: number[] = [];
      const normals: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];
      const faces: Array<[number[], number[], number[]]> = [
        [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
        [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
        [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
        [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
        [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
      ];
      for (const part of parts) {
        const half = part.size.map((value) => value / 2);
        for (const [n, u, v] of faces) {
          const base = positions.length / 3;
          for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
            for (let axis = 0; axis < 3; axis += 1) {
              positions.push(part.center[axis]! + (n[axis]! + u[axis]! * su + v[axis]! * sv) * half[axis]!);
            }
            normals.push(n[0]!, n[1]!, n[2]!);
            // Vertex colours are read as linear; palette colours are authored in sRGB.
            colors.push(part.color.r ** 2.2, part.color.g ** 2.2, part.color.b ** 2.2, 1);
          }
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
      return this.build(positions, indices, { normals, colors });
    });
  }

  /** Surface of revolution around +y from (radius, y) pairs, bottom to top. */
  lathe(name: string, profile: Array<[number, number]>, segments = 32, capBottom = false): pc.Mesh {
    return this.mesh(name, () => {
      const positions: number[] = [];
      const indices: number[] = [];
      const uvs: number[] = [];
      for (let ring = 0; ring < profile.length; ring += 1) {
        const [radius, y] = profile[ring]!;
        for (let segment = 0; segment < segments; segment += 1) {
          const angle = (segment / segments) * Math.PI * 2;
          positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
          uvs.push(segment / segments, ring / (profile.length - 1));
        }
      }
      for (let ring = 0; ring < profile.length - 1; ring += 1) {
        for (let segment = 0; segment < segments; segment += 1) {
          const a = ring * segments + segment;
          const b = ring * segments + ((segment + 1) % segments);
          const c = (ring + 1) * segments + segment;
          const d = (ring + 1) * segments + ((segment + 1) % segments);
          indices.push(a, c, b, b, c, d);
        }
      }
      if (capBottom) {
        const center = positions.length / 3;
        positions.push(0, profile[0]![1], 0);
        uvs.push(0.5, 0);
        for (let segment = 0; segment < segments; segment += 1) {
          indices.push(center, segment, (segment + 1) % segments);
        }
      }
      return this.build(positions, indices, { uvs });
    });
  }

  /** Lathe whose rim height varies around the circumference (for broken shell edges). */
  jaggedLathe(name: string, radiusAt: (t: number) => number, yAt: (t: number) => number, from: (angle: number) => number, to: (angle: number) => number, rings = 12, segments = 36): pc.Mesh {
    return this.mesh(name, () => {
      const positions: number[] = [];
      const indices: number[] = [];
      for (let ring = 0; ring <= rings; ring += 1) {
        for (let segment = 0; segment < segments; segment += 1) {
          const angle = (segment / segments) * Math.PI * 2;
          const t0 = from(angle);
          const t1 = to(angle);
          const t = t0 + (t1 - t0) * (ring / rings);
          const radius = radiusAt(t);
          positions.push(Math.cos(angle) * radius, yAt(t), Math.sin(angle) * radius);
        }
      }
      for (let ring = 0; ring < rings; ring += 1) {
        for (let segment = 0; segment < segments; segment += 1) {
          const a = ring * segments + segment;
          const b = ring * segments + ((segment + 1) % segments);
          const c = (ring + 1) * segments + segment;
          const d = (ring + 1) * segments + ((segment + 1) % segments);
          indices.push(a, c, b, b, c, d);
        }
      }
      return this.build(positions, indices);
    });
  }
}
