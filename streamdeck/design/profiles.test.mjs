import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPackText, loadSetupText } from "@runlog/rules-schema";

import { DEVICES, SKETCHES, SLUGS } from "./layouts.mjs";
import { container, layouts, profile, specs, table } from "./profiles.mjs";

/**
 * The profiles the plugin ships, held against the packs they were written
 * from and the grids they have to fit on.
 *
 * Nobody reads a `.streamDeckProfile`. It is a zip of compact JSON that goes
 * out with a release and turns up on somebody's desk, and the two ways it
 * goes wrong - a key off the edge of a Mini, a move whose id the pack
 * renamed last month - both look, to whoever imported it, like the plugin
 * being broken. So the generator is held to the grid and to the pack here,
 * where a mistake costs a test run rather than a support thread.
 */

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, "..", "com.scrthq.runlog.sdPlugin");
const repo = join(here, "..", "..");

const MANIFEST = JSON.parse(readFileSync(join(plugin, "manifest.json"), "utf8"));

/** Everything a key on one of these may be: our twelve actions, and the app's two turns. */
const ALLOWED = new Set([...MANIFEST.Actions.map((a) => a.UUID), "com.elgato.streamdeck.page.next", "com.elgato.streamdeck.page.previous"]);

/** Every action on every page of a built profile, with the page and position it sits at. */
function placed(built) {
  const out = [];
  for (const [path, page] of Object.entries(built.files)) {
    if (!page.Controllers) continue;
    for (const controller of page.Controllers) {
      for (const [position, action] of Object.entries(controller.Actions ?? {})) {
        out.push({ page: path, controller: controller.Type, position, action });
      }
    }
  }
  return out;
}

const all = specs().map((spec) => ({ spec, built: profile(spec) }));

describe("the profiles we ship", () => {
  it("lays one out for the generic keys and one for every pack that ships", () => {
    // The demo pack and every sketch, by the slug each takes from its file
    // name. Written out rather than read from the folder a second time: this
    // is the list, and a sketch that stopped parsing would otherwise drop
    // off it without a word.
    expect(layouts().map((l) => l.slug)).toEqual([
      "runlog",
      "demo",
      "elden-ring",
      "forfeits",
      "ladder-work",
      "practice-room",
      "rocket-league-ladder",
      "rocket-league-showdown",
      "run-of-show",
      "soundclash",
      "twenty-five",
    ]);
    const sketches = readdirSync(join(repo, SKETCHES)).filter((f) => f.endsWith(".yaml"));
    expect(layouts()).toHaveLength(sketches.length + 2);
    expect(all).toHaveLength(layouts().length * Object.keys(DEVICES).length);
    expect(all).toHaveLength(44);
  });

  it("is one per pack per device, and the manifest lists every one", () => {
    expect(all.map(({ spec }) => `${spec.slug}-${spec.device}`)).toEqual(MANIFEST.Profiles.map((p) => p.Name.replace("profiles/", "")));
    for (const p of MANIFEST.Profiles) {
      const device = p.Name.split("-").pop();
      expect(p.DeviceType, `${p.Name} should be laid out for the device it names`).toBe(DEVICES[device].type);
    }
  });

  it("installs the generic four with the plugin and a pack's four on demand", () => {
    // Forty profiles arriving on the day somebody installs the plugin is a
    // profile list nobody can find their own work in. A pack's four are
    // installed the first time a deck follows a run of that pack, and never
    // switch themselves on the way in: the plugin says when.
    for (const p of MANIFEST.Profiles) {
      const generic = p.Name.startsWith("profiles/runlog-");
      expect(p.AutoInstall, `${p.Name}`).toBe(generic);
      expect(p.DontAutoSwitchWhenInstalled, `${p.Name}`).toBe(true);
    }
    expect(MANIFEST.Profiles.filter((p) => p.AutoInstall)).toHaveLength(4);
  });

  it("hands the plugin a table of the names rather than letting it guess them", () => {
    // `src/profiles.ts` is written by the generator and read at run time. If
    // it is behind the packs on disk the plugin asks for a profile that is
    // not in the package, and the switch does nothing anybody can see.
    const written = readFileSync(join(here, "..", "src", "profiles.ts"), "utf8");
    expect(written.replace(/\r\n/g, "\n")).toBe(table().replace(/\r\n/g, "\n"));
    for (const layout of layouts()) {
      if (layout.pack) expect(written).toContain(`"${layout.pack.id}": "${layout.slug}"`);
    }
  });

  it("matches the profiles committed under the plugin, byte for byte", () => {
    // A `.streamDeckProfile` is generated and committed rather than built at
    // install time, so a layout change that nobody regenerated for leaves a
    // stale zip sitting next to the source that no longer agrees with it.
    // Comparing the built bytes against what is on disk is what catches
    // that, rather than the shape checks above passing on a file nobody
    // actually ships.
    for (const { spec, built } of all) {
      const path = join(plugin, "profiles", `${spec.slug}-${spec.device}.streamDeckProfile`);
      const committed = readFileSync(path);
      expect(committed.equals(container(built)), `${spec.slug}-${spec.device}`).toBe(true);
    }
  });

  it("keeps the slug Elden Ring's profile shipped under", () => {
    // Its file name says the tool as well as the game; its slug does not,
    // and changing that now would rename the profile on every deck that
    // already has it.
    expect(SLUGS["elden-ring-tarnishedtool"]).toBe("elden-ring");
    expect(layouts().find((l) => l.slug === "elden-ring").pack.id).toBe("com.scrthq.runlog.elden-ring-tarnishedtool");
  });

  it("builds the same bytes twice, so regenerating is not a diff", () => {
    for (const { spec } of all) {
      expect(container(profile(spec)).equals(container(profile(spec))), `${spec.slug}-${spec.device}`).toBe(true);
    }
  });

  it("knows how big each deck is", () => {
    // Written out rather than taken from `DEVICES`, which is the table under
    // test: the grid check below reads the same numbers the layout was built
    // from, so without this it would pass on any pair of them. These are the
    // SDK's, from the `DeviceType` enumeration in @elgato/schemas.
    expect(DEVICES.xl).toMatchObject({ type: 2, columns: 8, rows: 4, dials: 0 });
    expect(DEVICES.sd).toMatchObject({ type: 0, columns: 5, rows: 3, dials: 0 });
    expect(DEVICES.mini).toMatchObject({ type: 1, columns: 3, rows: 2, dials: 0 });
    expect(DEVICES.plus).toMatchObject({ type: 7, columns: 4, rows: 2, dials: 4 });
  });

  it("lays every key inside its own deck's grid", () => {
    for (const { spec, built } of all) {
      const { columns, rows, dials } = DEVICES[spec.device];
      for (const { controller, position } of placed(built)) {
        const [column, row] = position.split(",").map(Number);
        const width = controller === "Encoder" ? dials : columns;
        const height = controller === "Encoder" ? 1 : rows;
        expect(column, `${spec.slug}-${spec.device} ${position}`).toBeLessThan(width);
        expect(row, `${spec.slug}-${spec.device} ${position}`).toBeLessThan(height);
        expect(column).toBeGreaterThanOrEqual(0);
        expect(row).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("puts one thing in one place", () => {
    for (const { spec, built } of all) {
      const seen = new Set();
      for (const { page, controller, position } of placed(built)) {
        const where = `${page} ${controller} ${position}`;
        expect(seen.has(where), `${spec.slug}-${spec.device} doubles up on ${where}`).toBe(false);
        seen.add(where);
      }
    }
  });

  it("places nothing but our own actions and the app's page turns", () => {
    for (const { spec, built } of all) {
      for (const { action } of placed(built)) {
        expect(ALLOWED.has(action.UUID), `${spec.slug}-${spec.device} places ${action.UUID}`).toBe(true);
      }
    }
  });

  it("sets each key to what its own settings type allows", () => {
    // The shapes are `PressTarget`, `MetricField`, `SetupSettings` and
    // `NextSettings` in `src/state.ts`. A key set to something the plugin
    // cannot read draws "Set up" for ever and says nothing about why.
    const fields = new Set(["score", "unit", "clock", "latest", "leader"]);
    const kinds = new Set(["roll", "move", "answer"]);
    for (const { spec, built } of all) {
      for (const { action } of placed(built)) {
        const settings = action.Settings;
        const where = `${spec.slug}-${spec.device} ${action.UUID}`;
        if (action.UUID === "com.scrthq.runlog.metric") {
          const field = settings.field;
          if (typeof field === "string") expect(fields.has(field), where).toBe(true);
          else expect(Object.keys(field), where).toSatisfy((keys) => keys.length === 1 && ["counter", "resource"].includes(keys[0]));
        } else if (action.UUID === "com.scrthq.runlog.press") {
          expect(kinds.has(settings.target.kind), where).toBe(true);
          if (settings.target.kind === "move") expect(typeof settings.target.id, where).toBe("string");
        } else if (action.UUID === "com.scrthq.runlog.setup") {
          expect(Object.keys(settings.setup).sort(), where).toEqual(["id", "title"]);
        } else if (action.UUID === "com.scrthq.runlog.open") {
          expect(["run", "guide", "rules", "newrun", "dock"], where).toContain(settings.target);
        } else {
          expect(settings, where).toEqual({});
        }
      }
    }
  });

  it("gives a + its dials, and no other deck one", () => {
    for (const { spec, built } of all) {
      const wheels = placed(built).filter((p) => p.controller === "Encoder");
      if (spec.device !== "plus") {
        expect(wheels, `${spec.slug}-${spec.device}`).toHaveLength(0);
        continue;
      }
      // Only Next, Metric and Clock declare `Encoder` in the manifest.
      for (const { action } of wheels) {
        expect(["com.scrthq.runlog.next", "com.scrthq.runlog.metric", "com.scrthq.runlog.clock"]).toContain(action.UUID);
      }
    }
  });

  describe("the Elden Ring profile", () => {
    const pack = loadPackText(readFileSync(join(repo, "packs", "sketches", "elden-ring-tarnishedtool.yaml"), "utf8"), "yaml");
    const tool = JSON.parse(readFileSync(join(repo, "packs", "profiles", "elden-ring-tarnishedtool.json"), "utf8")).tool;
    const setups = ["bare-handed", "brute", "cleric", "glass", "long-night", "sorcerer", "well-armed"];

    it("loads the pack it is built from", () => {
      expect(pack.ok).toBe(true);
    });

    for (const device of Object.keys(DEVICES)) {
      it(`carries exactly the pack's moves, counters, resources and setups on a ${device}`, () => {
        const built = all.find(({ spec }) => spec.slug === "elden-ring" && spec.device === device).built;
        const settings = placed(built).map((p) => p.action.Settings);

        const moves = settings.filter((s) => s.target?.kind === "move").map((s) => s.target.id);
        expect(moves.sort()).toEqual(Object.keys(pack.pack.moves).sort());

        const counters = settings.filter((s) => typeof s.field === "object" && "counter" in s.field).map((s) => s.field.counter);
        const shown = Object.entries(pack.pack.counters)
          .filter(([, c]) => !c.hidden)
          .map(([id]) => id);
        expect(counters.sort()).toEqual(shown.sort());

        const resources = settings.filter((s) => typeof s.field === "object" && "resource" in s.field).map((s) => s.field.resource);
        expect(resources.sort()).toEqual(Object.keys(pack.pack.resources).sort());

        const chosen = settings.filter((s) => s.setup).map((s) => s.setup.id);
        expect(chosen.sort()).toEqual(shippedFor(tool).sort());
        // The loadouts, at least, and by id rather than by count: a setup
        // that stopped naming this tool would otherwise vanish unremarked.
        for (const id of setups) expect(chosen).toContain(`com.scrthq.runlog.setups.${id}`);
      });
    }
  });

  it("gives every profile the run and the guide, and only a pack's the rules", () => {
    for (const { spec, built } of all) {
      const targets = placed(built)
        .filter((p) => p.action.UUID === "com.scrthq.runlog.open")
        .map((p) => p.action.Settings.target)
        .sort();
      const want = spec.slug === "runlog" ? ["guide", "run"] : ["guide", "rules", "run"];
      expect(targets, `${spec.slug}-${spec.device}`).toEqual(want);
    }
  });

  it("gives the demo pack no setup keys, because it names no tool", () => {
    const built = all.find(({ spec }) => spec.slug === "demo" && spec.device === "xl").built;
    expect(placed(built).filter((p) => p.action.UUID === "com.scrthq.runlog.setup")).toHaveLength(0);
  });
});

/** Every shipped setup written for a tool, by id. */
function shippedFor(tool) {
  const dir = join(repo, "packs", "setups");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => loadSetupText(readFileSync(join(dir, f), "utf8"), "yaml"))
    .filter((r) => r.ok && r.setup.tool.toLowerCase() === tool.toLowerCase())
    .map((r) => r.setup.id);
}
