import { DodecahedronGeometry, IcosahedronGeometry, OctahedronGeometry, TetrahedronGeometry, Vector3, type Quaternion } from "three";

/**
 * The shapes of dice, as polygons.
 *
 * Every die is a convex polyhedron: a list of vertices and a list of
 * faces, each face the indices of its corners in order around the
 * outside. That is the one shape both engines want, cannon-es for a
 * collider, three.js for a mesh, and the one thing the roller has to
 * know about a die to read it: which face is on top.
 *
 * The regular ones come from three.js's own geometries, whose triangles
 * are grouped back into faces by their normal; the d10 is drawn by hand,
 * since a pentagonal trapezohedron is nobody's built-in.
 */
export interface Polyhedron {
  vertices: Array<[number, number, number]>;
  /** Corner indices per face, counter-clockwise seen from outside. */
  faces: number[][];
  /** Unit outward normal per face. */
  normals: Array<[number, number, number]>;
  /** Centroid per face. */
  centers: Array<[number, number, number]>;
  /** Radius of the circle that fits inside the face, for sizing a label. */
  inradius: number[];
}

const key = (v: Vector3) => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;

/** Group a non-indexed triangle geometry's triangles into flat faces by normal. */
function fromTriangles(positions: ArrayLike<number>): Polyhedron {
  const verts: Vector3[] = [];
  const index = new Map<string, number>();
  const vertexOf = (v: Vector3) => {
    const k = key(v);
    let i = index.get(k);
    if (i === undefined) {
      i = verts.length;
      verts.push(v.clone());
      index.set(k, i);
    }
    return i;
  };
  // Triangles of one face share a normal, give or take floating error, so
  // they are grouped by closeness rather than by exact value.
  const groups: Array<{ normal: Vector3; corners: Set<number> }> = [];
  for (let t = 0; t < positions.length; t += 9) {
    const a = new Vector3(positions[t]!, positions[t + 1]!, positions[t + 2]!);
    const b = new Vector3(positions[t + 3]!, positions[t + 4]!, positions[t + 5]!);
    const c = new Vector3(positions[t + 6]!, positions[t + 7]!, positions[t + 8]!);
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    let g = groups.find((x) => x.normal.dot(n) > 0.999);
    if (!g) {
      g = { normal: n, corners: new Set<number>() };
      groups.push(g);
    }
    for (const v of [a, b, c]) g.corners.add(vertexOf(v));
  }
  const faces: number[][] = [];
  const normals: Array<[number, number, number]> = [];
  for (const g of groups) {
    // Order the corners by angle around the face's center, seen from outside.
    const corners = [...g.corners];
    const center = corners.reduce((s, i) => s.add(verts[i]!), new Vector3()).divideScalar(corners.length);
    const u = new Vector3().subVectors(verts[corners[0]!]!, center).normalize();
    const w = new Vector3().crossVectors(g.normal, u);
    corners.sort((i, j) => {
      const pi = new Vector3().subVectors(verts[i]!, center);
      const pj = new Vector3().subVectors(verts[j]!, center);
      return Math.atan2(pi.dot(w), pi.dot(u)) - Math.atan2(pj.dot(w), pj.dot(u));
    });
    faces.push(corners);
    normals.push([g.normal.x, g.normal.y, g.normal.z]);
  }
  return finish(verts.map((v) => [v.x, v.y, v.z] as [number, number, number]), faces, normals);
}

function finish(vertices: Polyhedron["vertices"], faces: number[][], normals?: Polyhedron["normals"]): Polyhedron {
  const centers = faces.map((f) => {
    const c: [number, number, number] = [0, 0, 0];
    for (const i of f) {
      const v = vertices[i]!;
      c[0] += v[0];
      c[1] += v[1];
      c[2] += v[2];
    }
    return [c[0] / f.length, c[1] / f.length, c[2] / f.length] as [number, number, number];
  });
  const ns =
    normals ??
    faces.map((f) => {
      const [a, b, c] = [vertices[f[0]!]!, vertices[f[1]!]!, vertices[f[2]!]!];
      const n = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).cross(new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])).normalize();
      return [n.x, n.y, n.z] as [number, number, number];
    });
  const inradius = faces.map((f, fi) => {
    // Distance from the center to the nearest edge.
    const c = new Vector3(...centers[fi]!);
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < f.length; i += 1) {
      const a = new Vector3(...vertices[f[i]!]!);
      const b = new Vector3(...vertices[f[(i + 1) % f.length]!]!);
      const ab = new Vector3().subVectors(b, a);
      const t = Math.max(0, Math.min(1, new Vector3().subVectors(c, a).dot(ab) / ab.lengthSq()));
      best = Math.min(best, c.distanceTo(a.clone().addScaledVector(ab, t)));
    }
    return best;
  });
  return { vertices, faces, normals: ns, centers, inradius };
}

/** A pentagonal trapezohedron: ten kites, two poles. */
function d10(): Polyhedron {
  const vertices: Polyhedron["vertices"] = [];
  for (let i = 0; i < 10; i += 1) {
    const a = (i * Math.PI) / 5;
    vertices.push([Math.cos(a), 0.105 * (i % 2 ? 1 : -1), Math.sin(a)]);
  }
  vertices.push([0, -1, 0], [0, 1, 0]);
  // Each kite: pole, ring vertex, ring vertex two on, ring vertex between.
  const faces: number[][] = [];
  for (let i = 0; i < 10; i += 1) {
    const pole = i % 2 ? 11 : 10;
    const a = i;
    const b = (i + 1) % 10;
    const c = (i + 2) % 10;
    faces.push(i % 2 ? [pole, a, b, c] : [pole, c, b, a]);
  }
  const p = finish(vertices, faces);
  // Orient every face outward, whichever way the corners came.
  p.faces = p.faces.map((f, fi) => {
    const n = p.normals[fi]!;
    const c = p.centers[fi]!;
    return n[0] * c[0] + n[1] * c[1] + n[2] * c[2] < 0 ? [...f].reverse() : f;
  });
  return finish(p.vertices, p.faces);
}

const cache = new Map<number, Polyhedron>();

/** The shape for a die with this many faces; a d100's halves are d10s, anything unknown is a d6. */
export function polyhedron(faces: number): Polyhedron {
  const got = cache.get(faces);
  if (got) return got;
  let p: Polyhedron;
  switch (faces) {
    case 4:
      p = fromTriangles(new TetrahedronGeometry(1).toNonIndexed().getAttribute("position").array);
      break;
    case 8:
      p = fromTriangles(new OctahedronGeometry(1).toNonIndexed().getAttribute("position").array);
      break;
    case 10:
    case 100:
      p = d10();
      break;
    case 12:
      p = fromTriangles(new DodecahedronGeometry(1).toNonIndexed().getAttribute("position").array);
      break;
    case 20:
      p = fromTriangles(new IcosahedronGeometry(1).toNonIndexed().getAttribute("position").array);
      break;
    default: {
      const s = 0.62;
      p = finish(
        [
          [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
          [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s],
        ],
        [
          [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3],
        ],
      );
    }
  }
  cache.set(faces, p);
  return p;
}

/** The face pointing most upward once the die has come to rest in this orientation. */
export function topFace(p: Polyhedron, q: { x: number; y: number; z: number; w: number }): number {
  let best = 0;
  let bestY = Number.NEGATIVE_INFINITY;
  const up = new Vector3();
  p.normals.forEach((n, i) => {
    up.set(n[0], n[1], n[2]).applyQuaternion(q as Quaternion);
    if (up.y > bestY) {
      bestY = up.y;
      best = i;
    }
  });
  return best;
}

/**
 * What each face says, so that the face on top reads the decided value.
 *
 * The value was decided before the die moved; the physics only chose a
 * resting pose. Painting the value onto whichever face ended up on top,
 * and the rest of the die's numbers onto the others, makes the throw
 * honest without steering it. A d4 reads at its top corner, so the value
 * goes on every face that faces up.
 */
export function faceLabels(p: Polyhedron, faces: number, display: string, top: number, orientation?: { x: number; y: number; z: number; w: number }): string[] {
  const all = numbersFor(faces, display);
  const rest = all.filter((n) => n !== display);
  const labels: string[] = new Array<string>(p.faces.length).fill("");
  if (faces === 4 && orientation) {
    const up = new Vector3();
    p.normals.forEach((n, i) => {
      up.set(n[0], n[1], n[2]).applyQuaternion(orientation as Quaternion);
      labels[i] = up.y > 0 ? display : (rest[i % rest.length] ?? display);
    });
    return labels;
  }
  let r = 0;
  for (let i = 0; i < labels.length; i += 1) labels[i] = i === top ? display : (rest[r++ % Math.max(1, rest.length)] ?? display);
  return labels;
}

/** The numbers a die of this kind carries, in a plausible order, the decided one included. */
export function numbersFor(faces: number, display: string): string[] {
  if (faces === 10 || faces === 100) {
    // A tens die reads 00-90; a ones die 0-9.
    return display.length === 2 ? Array.from({ length: 10 }, (_, i) => String(i * 10).padStart(2, "0")) : Array.from({ length: 10 }, (_, i) => String(i));
  }
  const n = faces === 4 || faces === 8 || faces === 12 || faces === 20 || faces === 6 ? faces : 6;
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

/** A small, fast, seedable random source: the throw's impulses, never the value. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
