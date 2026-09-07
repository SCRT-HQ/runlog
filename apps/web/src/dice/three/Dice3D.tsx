import { useEffect, useRef } from "react";
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import type { RolledDie } from "../../rolling.ts";
import { faceLabels, polyhedron, type Polyhedron } from "./polyhedra.ts";
import { simulateThrow, TRAY, type Throw } from "./throw.ts";

/**
 * Dice thrown into a tray, in three dimensions.
 *
 * The throw is simulated to rest before the first frame (see throw.ts),
 * then played back: real physics, no waiting on it. The engine's value
 * is painted onto whichever face landed on top, so the dice never
 * disagree with the log, and the same seed plays the same tumble for
 * everyone watching. Colors come from the theme's own tokens, read from
 * the page, so the dice sit in whichever look is on.
 *
 * This file is loaded only when three-dimensional dice are switched on:
 * it is the one place three.js and cannon-es are imported.
 */
export interface Dice3DProps {
  dice: RolledDie[];
  rollId: number;
  seed: number;
  onSettled?: () => void;
  /** Height of the canvas in CSS pixels; the width is the container's. */
  height?: number;
}

const DIE_SIZE = 1;
const LABEL_PX = 128;

function themeColors(el: HTMLElement) {
  const css = getComputedStyle(el);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    body: read("--panel-2", "#26221e"),
    edge: read("--line-2", "#5a524a"),
    text: read("--text", "#ece5d8"),
    /** Numbers on a light body: the ground's own dark. */
    ink: read("--bg", "#151311"),
    challenge: read("--err", "#c96a5a"),
    accent: read("--accent", "#9fd3b6"),
  };
}

/** A flat-shaded mesh of the polyhedron, every face its own triangles. */
function dieGeometry(p: Polyhedron): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  p.faces.forEach((f, fi) => {
    const n = p.normals[fi]!;
    for (let i = 1; i + 1 < f.length; i += 1) {
      for (const idx of [f[0]!, f[i]!, f[i + 1]!]) {
        const v = p.vertices[idx]!;
        positions.push(v[0] * DIE_SIZE, v[1] * DIE_SIZE, v[2] * DIE_SIZE);
        normals.push(n[0], n[1], n[2]);
      }
    }
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  return g;
}

/** A number, drawn once, as a texture for a face. */
function labelTexture(text: string, color: string, font: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_PX;
  canvas.height = LABEL_PX;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, LABEL_PX, LABEL_PX);
  ctx.fillStyle = color;
  ctx.font = `600 ${text.length > 1 ? 64 : 80}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, LABEL_PX / 2, LABEL_PX / 2 + 4);
  // A 6 and a 9 tell apart by an underline, as on real dice.
  if (text === "6" || text === "9") ctx.fillRect(LABEL_PX / 2 - 22, LABEL_PX / 2 + 44, 44, 6);
  const tex = new CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

interface Built {
  group: Group;
  p: Polyhedron;
  labels: Mesh[];
}

function buildDie(die: RolledDie, colors: ReturnType<typeof themeColors>, font: string): Built {
  const p = polyhedron(die.faces);
  const body = new Mesh(
    dieGeometry(p),
    new MeshStandardMaterial({
      // The body sits between the panel and the text, so it reads as an object on the page rather than a hole in it.
      color: die.variant === "challenge" ? new Color(colors.challenge) : new Color(colors.edge).lerp(new Color(colors.text), 0.3),
      roughness: 0.55,
      metalness: 0.05,
      flatShading: true,
    }),
  );
  const group = new Group();
  group.add(body);
  const labels: Mesh[] = [];
  const up = new Vector3(0, 0, 1);
  p.faces.forEach((_, fi) => {
    const n = new Vector3(...p.normals[fi]!);
    const c = new Vector3(...p.centers[fi]!).multiplyScalar(DIE_SIZE);
    const size = p.inradius[fi]! * DIE_SIZE * (die.faces === 4 ? 1.1 : 1.5);
    const plane = new Mesh(new PlaneGeometry(size, size), new MeshStandardMaterial({ transparent: true, roughness: 0.6, metalness: 0 }));
    plane.position.copy(c).addScaledVector(n, 0.012);
    plane.quaternion.setFromUnitVectors(up, n);
    // A d4 reads at its top corner: the number sits toward the corner, not the middle.
    if (die.faces === 4) {
      const corner = p.faces[fi]!.map((i) => new Vector3(...p.vertices[i]!).multiplyScalar(DIE_SIZE)).sort((a, b) => b.y - a.y)[0]!;
      plane.position.lerp(corner, 0.45).addScaledVector(n, 0.012);
    }
    group.add(plane);
    labels.push(plane);
  });
  return { group, p, labels };
}

export function Dice3D({ dice, rollId, seed, onSettled, height = 180 }: Dice3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const settled = useRef(onSettled);
  settled.current = onSettled;

  useEffect(() => {
    const el = host.current;
    if (!el || dice.length === 0) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      settled.current?.();
      return;
    }
    const colors = themeColors(el);
    const font = getComputedStyle(el).getPropertyValue("--mono").trim() || "monospace";
    const width = Math.max(200, el.clientWidth);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.domElement.style.display = "block";
    el.replaceChildren(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 6.6, 3.9);
    camera.lookAt(0, 0.4, 0);
    scene.add(new AmbientLight(0xffffff, 1.4));
    const sun = new DirectionalLight(0xffffff, 2.4);
    sun.position.set(-4, 10, 5);
    scene.add(sun);
    const fill = new DirectionalLight(0xffffff, 0.9);
    fill.position.set(5, 6, -4);
    scene.add(fill);

    // The tray's floor: the theme's ground, so the dice sit on the page.
    const floor = new Mesh(new PlaneGeometry(TRAY.width + 2, TRAY.depth + 2), new MeshStandardMaterial({ color: new Color(getComputedStyle(el).getPropertyValue("--bg").trim() || "#151311"), roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const built = dice.map((d) => buildDie(d, colors, font));
    for (const b of built) scene.add(b.group);

    // The throw, all of it, before a frame is drawn.
    const thrown: Throw = simulateThrow(dice, seed);
    const textColor = (d: RolledDie) => (d.variant === "challenge" ? colors.text : colors.ink);
    built.forEach((b, i) => {
      const last = thrown.frames[i]!.at(-1)!;
      const q = new Quaternion(...last.quaternion);
      const labels = faceLabels(b.p, dice[i]!.faces, dice[i]!.display, thrown.tops[i]!, q);
      b.labels.forEach((plane, fi) => {
        const m = plane.material as MeshStandardMaterial;
        m.map = labelTexture(labels[fi]!, textColor(dice[i]!), font);
        m.needsUpdate = true;
      });
    });

    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = reduced ? Number.MAX_SAFE_INTEGER : 0;
    let raf = 0;
    let done = false;
    const start = performance.now();
    const place = (step: number) => {
      built.forEach((b, i) => {
        const frames = thrown.frames[i]!;
        const f = frames[Math.min(step, frames.length - 1)]!;
        b.group.position.set(f.position[0], f.position[1], f.position[2]);
        b.group.quaternion.set(f.quaternion[0], f.quaternion[1], f.quaternion[2], f.quaternion[3]);
      });
    };
    const longest = Math.max(...thrown.frames.map((f) => f.length));
    const finish = () => {
      if (done) return;
      done = true;
      place(longest - 1);
      renderer.render(scene, camera);
      settled.current?.();
    };
    const draw = () => {
      const now = performance.now();
      frame = reduced ? longest : Math.floor((now - start) / (thrown.dt * 1000));
      place(frame);
      renderer.render(scene, camera);
      if (frame >= longest - 1) {
        finish();
        return;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    // A tab in the background gets no animation frames; the dice still
    // land when the throw is over, so the answer is never left waiting.
    const byClock = setTimeout(finish, (reduced ? 0 : longest * thrown.dt * 1000) + 250);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(byClock);
      for (const b of built) {
        for (const plane of b.labels) {
          const m = plane.material as MeshStandardMaterial;
          m.map?.dispose();
          m.dispose();
          plane.geometry.dispose();
        }
        const body = b.group.children[0] as Mesh;
        body.geometry.dispose();
        (body.material as MeshStandardMaterial).dispose();
      }
      floor.geometry.dispose();
      (floor.material as MeshStandardMaterial).dispose();
      renderer.dispose();
      // Give the context back now: a browser allows only so many at once,
      // and a run throws many dice.
      renderer.forceContextLoss();
      el.replaceChildren();
    };
    // rollId is the signal to throw again; dice and seed travel with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollId]);

  return <div ref={host} className="dice3d" style={{ height }} aria-hidden="true" />;
}

export default Dice3D;
