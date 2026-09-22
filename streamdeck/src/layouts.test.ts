import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NEO_LAYOUT } from "./layouts.ts";

/**
 * The infobar layout is a file the Stream Deck software reads, and the
 * plugin only ever names it. Nothing else checks it: the CLI's validator
 * looks at the layouts the manifest points to, and no action lists the Neo
 * yet, so a rect that strays off the 232 x 50 bar or a key the plugin never
 * feeds would go unnoticed until somebody with a Neo saw nothing on it.
 */

const plugin = join(dirname(fileURLToPath(import.meta.url)), "..", "com.scrthq.runlog.sdPlugin");

interface Item {
  key: string;
  type: string;
  rect: [number, number, number, number];
  zOrder?: number;
}
interface Layout {
  id: string;
  controller?: string;
  items: Item[];
}

const layout = JSON.parse(readFileSync(join(plugin, NEO_LAYOUT), "utf8")) as Layout;

/** The bar on a Stream Deck Neo, in pixels. */
const NEO = { width: 232, height: 50 };

function overlaps(a: Item, b: Item): boolean {
  const [ax, ay, aw, ah] = a.rect;
  const [bx, by, bw, bh] = b.rect;
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

describe("the infobar layout", () => {
  it("is meant for the Neo", () => {
    expect(layout.controller).toBe("Neo");
    expect(layout.id).toBe("neo-face");
  });

  it("keeps every item on the bar, and off every other item", () => {
    for (const item of layout.items) {
      const [x, y, w, h] = item.rect;
      expect(x, item.key).toBeGreaterThanOrEqual(0);
      expect(y, item.key).toBeGreaterThanOrEqual(0);
      expect(x + w, item.key).toBeLessThanOrEqual(NEO.width);
      expect(y + h, item.key).toBeLessThanOrEqual(NEO.height);
    }
    for (const a of layout.items)
      for (const b of layout.items) {
        if (a === b || (a.zOrder ?? 0) !== (b.zOrder ?? 0)) continue;
        expect(overlaps(a, b), `${a.key} and ${b.key}`).toBe(false);
      }
  });

  it("has exactly the keys the plugin feeds, of kinds the bar can show", () => {
    expect(layout.items.map((i) => i.key).sort()).toEqual(["indicator", "label", "value"]);
    for (const item of layout.items) expect(["bar", "gbar", "pixmap", "text"], item.key).toContain(item.type);
    // "title" is special to the software: its font follows the user's
    // title settings, so the reading is not keyed that way.
    expect(layout.items.some((i) => i.key === "title")).toBe(false);
  });
});
