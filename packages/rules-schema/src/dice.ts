/**
 * Dice expression parsing.
 *
 * Lives in the schema package rather than the engine because the *shape* of a
 * dice expression is part of the pack contract: the linter needs to know that
 * a d100 lookup table must tile 1..100, and it can only know that by parsing.
 */

export interface ParsedDice {
  /** Number of dice rolled. */
  count: number;
  /** Faces per die. */
  faces: number;
  /** Flat modifier applied to the sum. */
  modifier: number;
  /** Lowest total the expression can produce. */
  min: number;
  /** Highest total the expression can produce. */
  max: number;
}

const DICE_RE = /^([1-9]\d*)?d([1-9]\d*)([+-]\d+)?$/;

export function parseDice(expr: string): ParsedDice {
  const m = DICE_RE.exec(expr.trim());
  if (!m) {
    throw new Error(
      `invalid dice expression ${JSON.stringify(expr)}; expected forms like d100, 2d10, d6+3`,
    );
  }
  const count = m[1] ? Number(m[1]) : 1;
  const faces = Number(m[2]);
  const modifier = m[3] ? Number(m[3]) : 0;
  return {
    count,
    faces,
    modifier,
    min: count + modifier,
    max: count * faces + modifier,
  };
}

export function tryParseDice(expr: string): ParsedDice | null {
  try {
    return parseDice(expr);
  } catch {
    return null;
  }
}

/**
 * Roll an expression with an injected random source.
 *
 * The source is a parameter rather than `Math.random` so that seeded runs and
 * replayed event logs produce identical results — which is what makes shared
 * "dungeon seeds" and deterministic tests possible.
 */
export function rollDice(expr: string, random: () => number): { total: number; dice: number[] } {
  const { count, faces, modifier } = parseDice(expr);
  const dice: number[] = [];
  for (let i = 0; i < count; i++) {
    dice.push(Math.floor(random() * faces) + 1);
  }
  const total = dice.reduce((a, b) => a + b, 0) + modifier;
  return { total, dice };
}
