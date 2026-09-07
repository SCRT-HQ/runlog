import { parseDice, type Pack } from "@runlog/rules-schema";

/**
 * The pack being written.
 *
 * Held as a plain object rather than as a validated `Pack`, because a draft is
 * invalid most of the time it exists: a table with no entries yet, a mode
 * halfway through being named. Validation runs *over* the draft on every
 * change and reports; it never gates editing. An editor that refuses your
 * keystrokes until the document is correct is an editor nobody finishes a
 * document in.
 */
export type Draft = Record<string, unknown>;

/** The id under which the single in-progress draft is kept. */
export const DRAFT_ID = "current";

/**
 * A new pack that already validates.
 *
 * Starting from something that loads matters more than starting from
 * something small: the first thing a new author sees should be a green
 * checkmark and a game they can press Play on, not a list of what is missing.
 */
export function blankPack(): Draft {
  return {
    schemaVersion: 1,
    id: "com.example.my-game",
    version: "0.1.0",
    title: "My Game",
    author: "",
    description: "",
    license: { id: "MIT", redistributable: true },
    capabilities: [],
    vocabulary: {
      run: { one: "Run", many: "Runs" },
      unit: { one: "Round", many: "Rounds" },
      subject: { one: "Piece", many: "Pieces" },
      finalize: "Finish",
    },
    unit: { createsSubject: true, min: 1, max: 12 },
    tables: {
      prompt: {
        resolution: "lookup",
        title: "The Prompt",
        description: "Rolled on entering a Round, to see what you are working against.",
        roll: "d6",
        entries: [
          { id: "p-open", range: [1, 3], text: "Anything goes." },
          { id: "p-tight", range: [4, 6], text: "Use only what you already have." },
        ],
      },
    },
    phases: [
      {
        id: "enter",
        label: "Open the Round",
        steps: [{ kind: "rollTable", table: "prompt", label: "Roll the Prompt" }],
      },
      {
        id: "work",
        label: "Work",
        steps: [
          { kind: "declareSubject", label: "What is this?" },
          {
            kind: "manual",
            label: "Make it.",
            description: "The app cannot see this. It only records that you did it.",
          },
        ],
      },
      {
        id: "close",
        label: "Finish",
        steps: [{ kind: "finalizeUnit", label: "Finish the Round" }],
      },
    ],
    modes: {
      standard: { label: "Standard", description: "The full game. Stop whenever you like." },
    },
    defaultMode: "standard",
  };
}

/**
 * The filename a pack should be saved as.
 *
 * Last segment of the reverse-DNS id, so `com.example.two-line-days` becomes
 * `two-line-days-0.1.0.yaml` rather than something nobody can find again.
 */
export function packFilename(draft: Draft, ext: "yaml" | "json" = "yaml"): string {
  const id = typeof draft.id === "string" ? draft.id : "pack";
  const version = typeof draft.version === "string" ? draft.version : "0.0.0";
  const slug = (id.split(".").pop() || "pack").replace(/[^A-Za-z0-9._-]/g, "-");
  return `${slug}-${version}.${ext}`;
}

/* ------------------------------------------------------------------ *
 * Range coverage
 * ------------------------------------------------------------------ */

export interface Segment {
  from: number;
  to: number;
  /** How many entries claim this span. 0 is a gap, 2+ is an overlap. */
  claims: number;
  /** Ids of the entries claiming it, for saying which ones collide. */
  entries: string[];
}

interface RangedEntry {
  id?: unknown;
  range?: unknown;
}

/**
 * Where a lookup table's ranges land, span by span.
 *
 * This is the mistake everyone makes and the one the linter can only report
 * after the fact: a d100 table whose ranges leave 43 unreachable, or hand two
 * entries to 78. Seeing it as you type is worth more than being told once you
 * save, because the fix is obvious while the numbers are still in your head.
 *
 * Returned as a run-length encoding rather than a per-number array so a d100
 * table is a handful of segments and not a hundred.
 */
export function coverage(roll: string, entries: readonly unknown[]): Segment[] {
  let min: number;
  let max: number;
  try {
    ({ min, max } = parseDice(roll));
  } catch {
    // Nothing, rather than a guessed span. The schema already complains about
    // an unreadable expression; a bar reporting "1–100 unreachable" on top of
    // that would be a second complaint, and a wrong one.
    return [];
  }
  if (max < min || max - min > 1000) return [];

  const claims = new Map<number, string[]>();
  for (const raw of entries) {
    const entry = raw as RangedEntry;
    const range = entry.range;
    if (!Array.isArray(range) || range.length !== 2) continue;
    const [from, to] = range as [unknown, unknown];
    if (typeof from !== "number" || typeof to !== "number") continue;
    const id = typeof entry.id === "string" ? entry.id : "?";
    for (let n = Math.max(min, from); n <= Math.min(max, to); n++) {
      const at = claims.get(n);
      if (at) at.push(id);
      else claims.set(n, [id]);
    }
  }

  const segments: Segment[] = [];
  for (let n = min; n <= max; n++) {
    const here = claims.get(n) ?? [];
    const last = segments.at(-1);
    // Same claimants as the previous number means the same segment; comparing
    // the joined ids keeps "claimed by a and b" distinct from "by a and c".
    if (last && last.claims === here.length && last.entries.join() === here.join()) {
      last.to = n;
      continue;
    }
    segments.push({ from: n, to: n, claims: here.length, entries: here });
  }
  return segments;
}

/** A one-line verdict on a lookup table's ranges, for the editor's header. */
export function coverageSummary(segments: readonly Segment[]): {
  ok: boolean;
  text: string;
} {
  const gaps = segments.filter((s) => s.claims === 0);
  const overlaps = segments.filter((s) => s.claims > 1);
  if (segments.length === 0) return { ok: true, text: "" };
  if (gaps.length === 0 && overlaps.length === 0) return { ok: true, text: "covered exactly" };

  const say = (list: readonly Segment[]) =>
    list
      .slice(0, 3)
      .map((s) => (s.from === s.to ? `${s.from}` : `${s.from}–${s.to}`))
      .join(", ") + (list.length > 3 ? `, +${list.length - 3} more` : "");

  const parts: string[] = [];
  if (gaps.length > 0) parts.push(`unreachable: ${say(gaps)}`);
  if (overlaps.length > 0) parts.push(`claimed twice: ${say(overlaps)}`);
  return { ok: false, text: parts.join(" · ") };
}

/** Narrow a draft to a Pack once it has been validated elsewhere. */
export const asPack = (draft: Draft): Pack => draft as unknown as Pack;
