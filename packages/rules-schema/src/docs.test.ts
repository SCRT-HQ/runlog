import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { actionInWords, diceNeeded, predicateInWords, scoreInWords, triggerInWords } from "./describe.ts";
import { DOC_KINDS, generateDoc, generateDocs, toHtml, toMarkdown, type Block } from "./docs.ts";
import { loadPackText } from "./load.ts";
import type { Pack } from "./pack.ts";

const here = dirname(fileURLToPath(import.meta.url));
function starter(): Pack {
  const text = readFileSync(join(here, "..", "..", "..", "packs", "demo", "pack.yaml"), "utf8");
  const r = loadPackText(text, "yaml");
  if (!r.ok) throw new Error("the starter pack does not load");
  return r.pack;
}

/** Every string a block carries, flattened, so a test can ask what a document says. */
function textOf(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case "heading":
        case "paragraph":
          return b.text;
        case "list":
          return b.items.join("\n");
        case "table":
          return [...b.columns, ...b.rows.flat()].join("\n");
        case "terms":
          return b.items.map((t) => `${t.term} ${t.text}`).join("\n");
        case "form":
          return b.fields.map((f) => f.label).join("\n");
        default:
          return "";
      }
    })
    .join("\n");
}

describe("the summary describes the game without giving it away", () => {
  const pack = starter();
  const doc = generateDoc(pack, "summary");
  const said = textOf(doc.blocks);

  it("names the tables and how they are rolled, and counts the parts", () => {
    for (const t of Object.values(pack.tables)) expect(said).toContain(t.title);
    expect(said).toMatch(/roll d100/i);
    expect(said).toContain("entries");
    for (const m of Object.values(pack.modes)) expect(said).toContain(m.label);
    for (const e of pack.endings ?? []) expect(said).toContain(e.label);
  });

  it("prints no entry text, no trigger, no ending text and no mode notes", () => {
    for (const t of Object.values(pack.tables)) for (const e of t.entries) expect(said).not.toContain(e.text);
    for (const e of pack.endings ?? []) if (e.text) expect(said).not.toContain(e.text);
    for (const m of Object.values(pack.modes)) for (const note of m.notes ?? []) expect(said).not.toContain(note);
    for (const tr of pack.triggers ?? []) for (const a of tr.do) if (a.do === "note") expect(said).not.toContain(a.text);
  });

  it("says what a person needs to own", () => {
    expect(said).toContain("percentile dice (d100)");
  });
});

describe("the full documents", () => {
  const pack = starter();
  const docs = generateDocs(pack);

  it("the rulebook prints every table entry and every ending, in the pack's own words", () => {
    const said = textOf(docs.rulebook.blocks);
    for (const t of Object.values(pack.tables)) for (const e of t.entries) expect(said).toContain(e.text);
    for (const e of pack.endings ?? []) expect(said).toContain(e.text ?? e.label);
    expect(said).toContain(`A ${pack.vocabulary.unit.one}, step by step`);
    for (const p of pack.phases) expect(said).toContain(p.label);
    expect(said).not.toContain("onFinalize");
    expect(said).not.toContain("modCounter");
  });

  it("the quick start has the flow but not the tables", () => {
    const said = textOf(docs.quickstart.blocks);
    for (const p of pack.phases) expect(said).toContain(p.label);
    const anyEntry = Object.values(pack.tables)[0]!.entries[0]!.text;
    expect(said).not.toContain(anyEntry);
  });

  it("the reference card is every table, compact, plus the things people forget", () => {
    const said = textOf(docs.reference.blocks);
    for (const t of Object.values(pack.tables)) for (const e of t.entries) expect(said).toContain(e.text);
    expect(docs.reference.layout).toBe("card");
    expect(docs.reference.blocks.filter((b) => b.kind === "table").every((b) => b.kind === "table" && b.compact)).toBe(true);
    expect(said).toContain("Frequently forgotten");
  });

  it("the run log sheet has a line per rolled table per unit, and the head has the tallies", () => {
    const said = textOf(docs.runlog.blocks);
    expect(docs.runlog.layout).toBe("sheet");
    const rolled = pack.phases.flatMap((p) => p.steps).filter((s) => s.kind === "rollTable");
    for (const s of rolled) if (s.kind === "rollTable") expect(said).toContain(pack.tables[s.table]!.title);
    for (const c of Object.values(pack.counters ?? {})) if (!c.hidden) expect(said).toContain(c.label);
    expect(said).toContain("Date");
  });

  it("renders to Markdown and to a self-contained printable HTML page", () => {
    for (const { kind } of DOC_KINDS) {
      const md = toMarkdown(docs[kind]);
      expect(md.startsWith(`# ${pack.title}`)).toBe(true);
      const html = toHtml(docs[kind]);
      expect(html).toContain("<!doctype html>");
      expect(html).toContain(`class="layout-${docs[kind].layout}"`);
      expect(html).not.toContain("<script");
    }

  });
});

describe("a pack in words", () => {
  const pack = starter();
  it("turns actions, predicates and triggers into sentences in the pack's nouns", () => {
    expect(actionInWords(pack, { do: "modCounter", counter: "calm", by: 1 })).toMatch(/\+1$/);
    expect(actionInWords(pack, { do: "modCounter", counter: "calm", by: -2 })).toMatch(/−2$/);
    expect(actionInWords(pack, { do: "forceUnit", count: 2 })).toBe(`add 2 more ${pack.vocabulary.unit.many} before the ${pack.vocabulary.run.one} may end`);
    expect(actionInWords(pack, { do: "rewind" })).toBe(`go back 1 ${pack.vocabulary.unit.one} when this ${pack.vocabulary.unit.one} closes`);
    expect(predicateInWords(pack, { unitIndex: { gte: 4 } })).toBe(`the ${pack.vocabulary.unit.one} number is 4 or more`);
    expect(predicateInWords(pack, { ask: "Is it done?" })).toContain("Is it done?");
    expect(triggerInWords(pack, { on: "onFinalize", do: [{ do: "note", text: "Stop." }] })).toBe(`When you ${pack.vocabulary.finalize}: Stop`);
  });

  it("finds every die the pack rolls", () => {
    const dice = diceNeeded(pack);
    expect(dice).toContain("d100");
    expect(dice).toContain("d10");
    expect(dice).toContain("d6");
  });

  it("says how a run is scored, defaulting the name, the direction and the tiebreak", () => {
    expect(scoreInWords(pack, { counter: "calm", label: "Clean Blocks", tiebreak: "time" })).toBe(
      "Scored by Clean Blocks; higher is better, ties by time.",
    );
    // No label: falls back to the counter's own.
    expect(scoreInWords(pack, { counter: "calm" })).toBe("Scored by Calm streak; higher is better.");
    // A resource can flip which way wins.
    expect(scoreInWords(pack, { resource: "glaze", better: "lower" })).toBe("Scored by Glaze; lower is better.");
    // Units falls back to "<the pack's plural> closed".
    expect(scoreInWords(pack, { units: true })).toBe(`Scored by ${pack.vocabulary.unit.many} closed; higher is better.`);
    // Time defaults to lower being better, unlike everything else.
    expect(scoreInWords(pack, { time: true })).toBe("Scored by Time; lower is better.");
  });
});
