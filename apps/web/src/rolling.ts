import { parseDice, rollDice, type Pack, type Table } from "@runlog/rules-schema";

/**
 * Resolving a roll against each kind of table.
 *
 * This is deliberately the *only* place the inspector knows what a resolution
 * kind means, and it branches on data rather than on which game is loaded. If a
 * fifth kind is added, it fails to compile here and nowhere else.
 *
 * Two things every result carries:
 *
 *  - `working`, a human-readable derivation. A tool that hands you a verdict
 *    with no visible reasoning is exactly what tabletop players distrust about
 *    computers, and the fix is simply to show it.
 *  - `dice`, the individual dice that produced it. The value is decided here,
 *    from the injected random source, *before* anything is animated. The
 *    animation only ever settles onto a result that already exists, which is
 *    what keeps a seeded run reproducible no matter how it is presented.
 */

export interface RolledDie {
  /** Faces, which picks the silhouette. */
  faces: number;
  /** What the face shows. Not always the value: percentile tens read 00–90. */
  display: string;
  /** Shown under the die. */
  label: string;
  /** Opposition dice are drawn differently from the action die. */
  variant?: "normal" | "challenge";
}

export interface RollResult {
  entryId: string | null;
  working: string;
  headline: string;
  dice: RolledDie[];
}

/**
 * How a roll is presented as physical dice.
 *
 * A d100 becomes a percentile pair, because that is what is actually on the
 * table: a tens die reading 00–90 and a ones die reading 0–9, with 00 and 0
 * meaning 100.
 */
export function toDisplayDice(expr: string, values: number[], total: number): RolledDie[] {
  const { faces } = parseDice(expr);

  if (faces === 100 && values.length === 1) {
    const tens = (total % 100) - (total % 10);
    return [
      { faces: 10, display: String(tens).padStart(2, "0"), label: "tens" },
      { faces: 10, display: String(total % 10), label: "ones" },
    ];
  }

  return values.map((v) => ({ faces, display: String(v), label: `d${faces}` }));
}

export function resolveRoll(
  table: Table,
  pack: Pack,
  random: () => number = Math.random,
): RollResult {
  switch (table.resolution) {
    case "lookup": {
      const { total, values } = roll(table.roll, random);
      const entry = table.entries.find((e) => total >= e.range[0] && total <= e.range[1]);
      return {
        entryId: entry?.id ?? null,
        headline: String(total),
        dice: toDisplayDice(table.roll, values, total),
        working: entry
          ? `${table.roll} → ${total}, which falls in ${entry.range[0]}–${entry.range[1]}`
          : `${table.roll} → ${total}, which no entry covers — the pack has a gap`,
      };
    }

    case "bands": {
      const { total, values } = roll(table.roll, random);
      const entry = table.entries.find(
        (e) => (e.gte ?? -Infinity) <= total && total <= (e.lte ?? Infinity),
      );
      const bound = entry
        ? [
            entry.gte !== undefined ? `≥ ${entry.gte}` : null,
            entry.lte !== undefined ? `≤ ${entry.lte}` : null,
          ]
            .filter(Boolean)
            .join(" and ")
        : "";
      return {
        entryId: entry?.id ?? null,
        headline: String(total),
        dice: toDisplayDice(table.roll, values, total),
        working: entry
          ? `${table.roll} → ${values.join(" + ")} = ${total}, matching the band ${bound}`
          : `${table.roll} → ${total}, which matches no band`,
      };
    }

    case "opposed": {
      // The case a single total cannot express: each challenge die is compared
      // on its own, and ties go to the challenge.
      const action = roll(table.action, random);
      const bonus = table.addResource ? (pack.resources?.[table.addResource]?.initial ?? 0) : 0;
      const score = action.total + bonus;

      const challenge = Array.from(
        { length: table.challenge.count },
        () => roll(table.challenge.dice, random).total,
      );
      const beaten = challenge.filter((c) => score > c).length;
      const entry = table.entries.find((e) => e.beats === beaten);
      const bonusText = table.addResource ? ` + ${bonus} ${table.addResource}` : "";

      const challengeFaces = parseDice(table.challenge.dice).faces;
      return {
        entryId: entry?.id ?? null,
        headline: `${score} vs ${challenge.join(", ")}`,
        dice: [
          ...toDisplayDice(table.action, action.values, action.total).map((d) => ({
            ...d,
            label: "action",
          })),
          ...challenge.map((c) => ({
            faces: challengeFaces,
            display: String(c),
            label: "challenge",
            variant: "challenge" as const,
          })),
        ],
        working:
          `${table.action} → ${action.total}${bonusText} = ${score}, ` +
          `against ${challenge.join(" and ")} — beats ${beaten} of ${table.challenge.count} ` +
          `(ties go to the challenge)`,
      };
    }

    case "keyed": {
      // Standing in for a card draw: pick a key uniformly.
      const index = Math.floor(random() * table.entries.length);
      const entry = table.entries[index];
      return {
        entryId: entry?.id ?? null,
        headline: entry?.key ?? "—",
        dice: [],
        working: `drew ${entry?.key ?? "nothing"} from ${table.entries.length} possible keys`,
      };
    }
  }
}

function roll(expr: string, random: () => number) {
  const { total, dice } = rollDice(expr, random);
  return { total, values: dice };
}

// The entry keys and the roll description are shared with the command line
// and the generated documents, so they live in the schema package.
export { entryKeys, describeRoll } from "@runlog/rules-schema";
