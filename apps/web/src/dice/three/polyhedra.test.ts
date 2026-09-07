import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { faceLabels, mulberry32, numbersFor, polyhedron, topFace } from "./polyhedra.ts";
import { simulateThrow } from "./throw.ts";

describe("the shapes of dice", () => {
  it("have the right number of faces, each a closed polygon pointing outward", () => {
    for (const [faces, expected, corners] of [
      [4, 4, 3],
      [6, 6, 4],
      [8, 8, 3],
      [10, 10, 4],
      [12, 12, 5],
      [20, 20, 3],
    ] as const) {
      const p = polyhedron(faces);
      expect(p.faces).toHaveLength(expected);
      expect(p.faces.every((f) => f.length === corners)).toBe(true);
      // Every normal points away from the middle, and every inradius is a real length.
      p.faces.forEach((_, i) => {
        const n = p.normals[i]!;
        const c = p.centers[i]!;
        expect(n[0] * c[0] + n[1] * c[1] + n[2] * c[2]).toBeGreaterThan(0);
        expect(p.inradius[i]).toBeGreaterThan(0.05);
      });
    }
  });

  it("reads the face on top from an orientation", () => {
    const p = polyhedron(6);
    const upIndex = p.normals.findIndex((n) => n[1] > 0.99);
    expect(topFace(p, { x: 0, y: 0, z: 0, w: 1 })).toBe(upIndex);
    // Turned over: the face that was underneath is on top.
    const flipped = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
    const downIndex = p.normals.findIndex((n) => n[1] < -0.99);
    expect(topFace(p, flipped)).toBe(downIndex);
  });

  it("paints the decided value on the top face and the rest of the numbers elsewhere", () => {
    const p = polyhedron(20);
    const labels = faceLabels(p, 20, "14", 7);
    expect(labels[7]).toBe("14");
    expect(labels.filter((l) => l === "14")).toHaveLength(1);
    expect(new Set(labels).size).toBe(20);
    expect(numbersFor(10, "40")).toEqual(["00", "10", "20", "30", "40", "50", "60", "70", "80", "90"]);
    expect(numbersFor(10, "7")).toHaveLength(10);
  });

  it("gives a d4 its value on every face that faces up", () => {
    const p = polyhedron(4);
    const rest = { x: 0, y: 0, z: 0, w: 1 };
    const labels = faceLabels(p, 4, "3", topFace(p, rest), rest);
    const up = p.normals.filter((n) => n[1] > 0).length;
    expect(labels.filter((l) => l === "3")).toHaveLength(up);
  });
});

describe("a throw", () => {
  it("comes to rest inside the tray, the same way twice for the same seed, and differently for another", () => {
    const dice = [{ faces: 20 }, { faces: 6 }, { faces: 10 }];
    const a = simulateThrow(dice, 42);
    const b = simulateThrow(dice, 42);
    const c = simulateThrow(dice, 43);
    expect(a.frames).toHaveLength(3);
    expect(a.frames[0]!.length).toBeGreaterThan(30);
    expect(a.frames[0]!.length).toBeLessThanOrEqual(60 * 7);
    for (const die of a.frames) {
      const last = die.at(-1)!;
      expect(Math.abs(last.position[0])).toBeLessThan(6);
      expect(Math.abs(last.position[2])).toBeLessThan(4);
      expect(last.position[1]).toBeGreaterThan(0);
      // On the floor, or at worst on another die.
      expect(last.position[1]).toBeLessThan(3.2);
    }
    expect(a.tops).toEqual(b.tops);
    expect(a.frames[0]!.at(-1)).toEqual(b.frames[0]!.at(-1));
    expect(a.frames[0]!.at(-1)).not.toEqual(c.frames[0]!.at(-1));
  });

  it("has a seedable source that is the same every time", () => {
    const r1 = mulberry32(7);
    const r2 = mulberry32(7);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
    expect(mulberry32(8)()).not.toBe(mulberry32(7)());
  });
});
