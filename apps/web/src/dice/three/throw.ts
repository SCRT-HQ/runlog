import { Body, Box, ConvexPolyhedron, Material, Plane, Quaternion as CQuaternion, Vec3, World } from "cannon-es";
import { mulberry32, polyhedron, topFace } from "./polyhedra.ts";

/**
 * A throw, simulated ahead of time.
 *
 * The dice are dropped into a tray with a seeded shove and the physics
 * runs to rest before a single frame is drawn. What comes out is every
 * frame of every die and, for each, the face that ended up on top; the
 * roller then plays the frames back and paints the decided value onto
 * that face. So the throw is real physics, the value is the engine's,
 * and two machines given the same seed see the same tumble.
 */
export interface ThrowFrame {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

export interface Throw {
  /** frames[die][step] */
  frames: ThrowFrame[][];
  /** The face on top at rest, per die. */
  tops: number[];
  /** Seconds per step. */
  dt: number;
}

export const TRAY = { width: 7.5, depth: 4.4, wall: 0.5 } as const;
const DT = 1 / 60;
const MAX_STEPS = 60 * 7;
const SETTLED_STEPS = 24;

export function simulateThrow(dice: ReadonlyArray<{ faces: number }>, seed: number): Throw {
  const random = mulberry32(seed);
  const world = new World({ gravity: new Vec3(0, -30, 0), allowSleep: true });
  world.defaultContactMaterial.friction = 0.25;
  world.defaultContactMaterial.restitution = 0.35;

  const ground = new Body({ mass: 0, shape: new Plane(), material: new Material() });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);
  // Four walls, so the dice stay in the tray however hard they are thrown.
  const halfW = TRAY.width / 2;
  const halfD = TRAY.depth / 2;
  for (const [x, z, sx, sz] of [
    [halfW + TRAY.wall, 0, TRAY.wall, halfD + TRAY.wall],
    [-halfW - TRAY.wall, 0, TRAY.wall, halfD + TRAY.wall],
    [0, halfD + TRAY.wall, halfW + TRAY.wall, TRAY.wall],
    [0, -halfD - TRAY.wall, halfW + TRAY.wall, TRAY.wall],
  ] as const) {
    const wall = new Body({ mass: 0, shape: new Box(new Vec3(sx, 6, sz)) });
    wall.position.set(x, 6, z);
    world.addBody(wall);
  }

  const bodies = dice.map((die, i) => {
    const p = polyhedron(die.faces);
    const shape = new ConvexPolyhedron({
      vertices: p.vertices.map((v) => new Vec3(v[0], v[1], v[2])),
      faces: p.faces.map((f) => [...f]),
    });
    const body = new Body({ mass: 1, shape, sleepSpeedLimit: 0.6, sleepTimeLimit: 0.2, angularDamping: 0.15, linearDamping: 0.05 });
    // In from one side, spread along it, with a spin: a handful thrown, not dropped.
    const lane = dice.length === 1 ? 0 : (i / (dice.length - 1) - 0.5) * (TRAY.depth - 2);
    body.position.set(-halfW + 1.2 + random() * 0.8, 2.2 + random() * 1.2 + i * 0.4, lane + (random() - 0.5) * 0.6);
    body.quaternion = new CQuaternion().setFromEuler(random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2);
    body.velocity.set(7 + random() * 4, 1 + random() * 2, (random() - 0.5) * 3);
    body.angularVelocity.set((random() - 0.5) * 24, (random() - 0.5) * 24, (random() - 0.5) * 24);
    world.addBody(body);
    return body;
  });

  const frames: ThrowFrame[][] = bodies.map(() => []);
  let still = 0;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    world.step(DT);
    bodies.forEach((b, i) => {
      frames[i]!.push({ position: [b.position.x, b.position.y, b.position.z], quaternion: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w] });
    });
    const quiet = bodies.every((b) => b.sleepState === Body.SLEEPING || (b.velocity.length() < 0.15 && b.angularVelocity.length() < 0.25));
    still = quiet ? still + 1 : 0;
    if (still >= SETTLED_STEPS) break;
  }
  const tops = bodies.map((b, i) => topFace(polyhedron(dice[i]!.faces), b.quaternion));
  return { frames, tops, dt: DT };
}
