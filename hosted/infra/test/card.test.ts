import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPackText } from "@runlog/rules-schema";
import { agenda, reduce, type Pending, type RunEvent } from "@runlog/engine";
import { cardFor } from "../lib/handlers/discord/card";

/**
 * The table card, built from a run: what a choice among pieces says of
 * each, so a pick is by what a piece is and not by its number alone.
 */
describe("the table card", () => {
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
    const card = cardFor({ pack, state, events, agenda: agenda(pack, state, events), run: { sessionId: "01ABC", hostName: "Mira" }, pending });
    const select = card.components.flatMap((r) => (r as { components: Array<Record<string, unknown>> }).components).find((c) => c["type"] === 3 && String(c["custom_id"]).includes(":target"));
    expect(select).toBeDefined();
    const options = select!["options"] as Array<{ label: string; value: string; description?: string }>;
    expect(options.map((o) => o.label)).toEqual(["Piece 1", "Piece 2", "Piece 3"]);
    // What the piece is, and its states, as the board says them; the piece not yet declared says so.
    expect(options[0]!.description).toBe("Tall vase · [LK]");
    expect(options[1]!.description).toBe("Wide bowl");
    expect(options[2]!.description).toBe("undeclared");
  });
});
