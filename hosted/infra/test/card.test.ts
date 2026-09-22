import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { agenda, reduce, type Pending, type RunEvent } from "@runlog/engine";
import type { LiveSnapshot } from "@runlog/engine";
import { cardFor, partyCardFor, partyClosingLine } from "../lib/handlers/discord/card";

/**
 * The table card, built from a run: what a choice among pieces says of
 * each, so a pick is by what a piece is and not by its number alone.
 */
describe("the table card", () => {
  it("says what the pack says on entering the unit, first on the card, until its first step is done", () => {
    const text = readFileSync(join(__dirname, "..", "..", "..", "packs", "demo", "pack.yaml"), "utf8");
    const loaded = loadPackText(text, "yaml");
    if (!loaded.ok) throw new Error("the demo pack did not load");
    const pack = {
      ...loaded.pack,
      unit: { ...loaded.pack.unit, intro: "Welcome to the kiln yard.", onEnter: "Stage {n}: wedge, throw, fire." },
    };
    const at = "2026-01-01T00:00:00Z";
    const events = [
      { t: "RunStarted", at, id: "e1", runId: "r1", packId: pack.id, packVersion: pack.version, mode: "standard", players: 1 },
      { t: "UnitEntered", at, id: "e2" },
    ] as unknown as RunEvent[];
    const state = reduce(pack, events);
    const card = cardFor({ pack, state, events, agenda: agenda(pack, state, events), run: { sessionId: "01ABC", hostName: "Mira" } });
    const fields = (card.embeds[0] as { fields: Array<{ name: string; value: string }> }).fields;
    expect(fields.slice(0, 2)).toEqual([
      { name: "Welcome", value: "Welcome to the kiln yard." },
      { name: "This stage", value: "Stage 1: wedge, throw, fire." },
    ]);
    // A quiet pack's card says nothing of the kind.
    const quiet = cardFor({
      pack: loaded.pack,
      state,
      events,
      agenda: agenda(loaded.pack, state, events),
      run: { sessionId: "01ABC", hostName: "Mira" },
    });
    expect(((quiet.embeds[0] as { fields: Array<{ name: string }> }).fields ?? []).some((f) => f.name === "Welcome")).toBe(false);
  });

  it("says what each piece is under its name in a choice among them, the way the board does", () => {
    const text = readFileSync(join(__dirname, "..", "..", "..", "packs", "demo", "pack.yaml"), "utf8");
    const loaded = loadPackText(text, "yaml");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const pack = loaded.pack;
    const at = "2026-01-01T00:00:00Z";
    const events: RunEvent[] = [
      { t: "RunStarted", at, id: "e1", runId: "r1", packId: pack.id, packVersion: pack.version, mode: "standard", players: 1 },
      { t: "UnitEntered", at, id: "e2" },
      { t: "SubjectDeclared", at, id: "e3", subjectType: "Tall vase" },
      { t: "StateApplied", at, id: "e4", state: "locked", subject: 1 },
      { t: "UnitFinalized", at, id: "e5" },
      { t: "UnitEntered", at, id: "e6" },
      { t: "SubjectDeclared", at, id: "e7", subjectType: "Wide bowl" },
      { t: "UnitFinalized", at, id: "e8" },
      { t: "UnitEntered", at, id: "e9" },
    ] as unknown as RunEvent[];
    const state = reduce(pack, events);
    const pending = {
      kind: "table",
      tableId: "setback",
      keyPrefix: "t",
      answers: {},
      generated: [],
      request: { kind: "chooseTarget", key: "target", label: "Choose which piece suffers", eligible: [1, 2, 3] },
    } as unknown as Pending;
    const card = cardFor({
      pack,
      state,
      events,
      agenda: agenda(pack, state, events),
      run: { sessionId: "01ABC", hostName: "Mira" },
      pending,
    });
    const select = card.components
      .flatMap((r) => (r as { components: Array<Record<string, unknown>> }).components)
      .find((c) => c["type"] === 3 && String(c["custom_id"]).includes(":target"));
    expect(select).toBeDefined();
    const options = select!["options"] as Array<{ label: string; value: string; description?: string }>;
    expect(options.map((o) => o.label)).toEqual(["Piece 1", "Piece 2", "Piece 3"]);
    // What the piece is, and its states, as the board says them; the piece not yet declared says so.
    expect(options[0]!.description).toBe("Tall vase · [LK]");
    expect(options[1]!.description).toBe("Wide bowl");
    expect(options[2]!.description).toBe("undeclared");
  });
});

const snapshot = (over: Partial<LiveSnapshot> = {}): LiveSnapshot =>
  ({
    v: 1,
    at: "2026-09-16T10:00:00.000Z",
    packId: "com.example.kiln",
    packTitle: "The Long Kiln",
    runName: "Thursday",
    mode: "Standard Firing",
    words: { run: "Firing", unit: "Stage", units: "Stages" },
    status: "active",
    ending: null,
    unit: 3,
    where: "Draw · Twist",
    step: "Twist",
    quoted: false,
    standings: [],
    contestants: 0,
    subjects: [],
    counters: [{ id: "c", label: "Cracks", value: 2 }],
    resources: [],
    clocks: [],
    progress: { unitsDone: 2, elapsedMs: 0, timed: false },
    score: { label: "Stages", text: "2 stages", value: 2, better: "higher" },
    forcedUnits: 0,
    plannedUnits: null,
    log: [
      { n: 9, unit: 3, where: "Stage 3, Twist", hit: null, text: "No music in the kiln room." },
      { n: 8, unit: 3, where: "Stage 3, Weather", hit: null, text: "Rain on the roof." },
      { n: 7, unit: 2, where: "Stage 2, Twist", hit: null, text: "The glaze runs." },
      { n: 6, unit: 2, where: "Stage 2, Weather", hit: null, text: "Still air." },
    ],
    latest: { where: "Stage 3, Twist", text: "No music in the kiln room." },
    ...over,
  }) as LiveSnapshot;

describe("a watch party's card", () => {
  const link = "https://runlog.test/r/01RUN?t=livetok";

  it("carries no presses at all", () => {
    expect(partyCardFor({ snapshot: snapshot(), link, openedByName: "Mira" }).components).toEqual([]);
  });

  it("says the run, the pack, the unit, the latest result and the link", () => {
    const card = partyCardFor({ snapshot: snapshot(), link, openedByName: "Mira" });
    const embed = card.embeds[0]!;
    expect(embed.title).toBe("Thursday · The Long Kiln · Standard Firing");
    expect(embed.description).toContain("Stage 3");
    expect(embed.description).toContain("Draw · Twist");
    const field = (name: string) => embed.fields?.find((f) => f.name === name)?.value;
    expect(field("Latest")).toBe("Stage 3, Twist: No music in the kiln room.");
    expect(field("Watch it live")).toBe(link);
    expect(embed.footer?.text).toBe("Opened by Mira · Runlog");
  });

  it("shows the last three log lines and no more", () => {
    const lines = partyCardFor({ snapshot: snapshot(), link, openedByName: "Mira" }).embeds[0]!.fields!.find((f) => f.name === "The log")!;
    expect(lines.value.split("\n")).toHaveLength(3);
    expect(lines.value).toContain("No music in the kiln room.");
    expect(lines.value).not.toContain("Still air.");
  });

  it("shows the scoreboard where the mode has one, and leaves it off where it has none", () => {
    const plain = partyCardFor({ snapshot: snapshot(), link, openedByName: "Mira" }).embeds[0]!;
    expect(plain.fields?.some((f) => f.name === "Standings")).toBe(false);
    const scored = partyCardFor({
      snapshot: snapshot({ standings: [{ name: "Kel", points: 4, place: 1, states: [] }], contestants: 1 }),
      link,
      openedByName: "Mira",
    }).embeds[0]!;
    expect(scored.fields?.find((f) => f.name === "Standings")?.value).toBe("#1 Kel · 4");
  });

  it("takes the run's ending when it is over", () => {
    const card = partyCardFor({ snapshot: snapshot({ status: "ended", ending: "Cooled" }), link, openedByName: "Mira" });
    expect(card.embeds[0]!.description).toBe("Ended · Cooled");
    expect(card.embeds[0]!.color).toBe(0x6b7370);
  });

  it("says on the card itself that the run went on, for a party closed early", () => {
    const card = partyCardFor({ snapshot: snapshot(), link, openedByName: "Mira", closed: "byHand" });
    expect(card.embeds[0]!.fields?.find((f) => f.name === "The party is closed")?.value).toBe(
      "The firing went on without it. This card is where it stood.",
    );
  });

  it("words the closing line for the thread out of the run's own words", () => {
    expect(partyClosingLine(snapshot({ status: "ended", ending: "Cooled" }))).toBe(
      "The firing is over: Cooled. The card above is where it finished.",
    );
    expect(partyClosingLine(snapshot({ status: "ended", ending: null }))).toBe("The firing is over. The card above is where it finished.");
  });

  it("says what the host has handed out since the party opened, newest last", () => {
    const card = partyCardFor({
      snapshot: snapshot(),
      link,
      openedByName: "Mira",
      handouts: [
        { id: "s1", title: "The starter kit" },
        { id: "s2", title: "The kiln kit" },
      ],
    });
    expect(card.embeds[0]!.fields?.find((f) => f.name === "Handed out")?.value).toBe("The starter kit\nThe kiln kit");
  });

  it("has no handout field where nothing has been handed out", () => {
    const card = partyCardFor({ snapshot: snapshot(), link, openedByName: "Mira", handouts: [] });
    expect(card.embeds[0]!.fields?.some((f) => f.name === "Handed out")).toBe(false);
  });

  it("names no table the snapshot did not already name", () => {
    const card = partyCardFor({ snapshot: snapshot(), link, openedByName: "Mira" });
    expect(JSON.stringify(card)).not.toContain("tables");
  });
});
