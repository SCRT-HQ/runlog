import type { Pack } from "@runlog/rules-schema";
import { reduce, type RunEvent } from "@runlog/engine";

/**
 * Replaying the self-tests a pack ships with.
 *
 * This is how an author proves their tables behave — and, more usefully, how
 * they keep proving it after an edit. A pack with fixtures is one somebody
 * else can pick up and change without guessing at what they broke.
 *
 * Kept out of `bin.ts` so it can be tested directly rather than by scraping
 * the output of a process.
 */

export interface Assertion {
  path: string;
  expected: unknown;
  actual: unknown;
  ok: boolean;
}

export interface FixtureResult {
  name: string;
  ok: boolean;
  assertions: Assertion[];
  /** Set when the replay itself failed, rather than an assertion. */
  error?: string;
}

/**
 * Fill in what a fixture leaves out.
 *
 * Fixtures are written by hand, so they say what matters and omit the
 * bookkeeping: the pack a run belongs to, and a timestamp on every event.
 * Requiring an author to write `packId` on every `RunStarted` would make
 * fixtures tedious enough that nobody writes them.
 */
function normalize(pack: Pack, events: readonly unknown[]): RunEvent[] {
  const base = Date.parse("2020-01-01T00:00:00.000Z");
  return events.map((raw, i) => {
    const event = { ...(raw as Record<string, unknown>) };
    event.at ??= new Date(base + i * 1000).toISOString();
    if (event.t === "RunStarted") {
      event.packId ??= pack.id;
      event.packVersion ??= pack.version;
      event.mode ??= pack.defaultMode;
    }
    return event as unknown as RunEvent;
  });
}

/** Read a dotted path out of derived state. Missing segments give undefined. */
export function readPath(state: unknown, path: string): unknown {
  let cursor: unknown = state;
  for (const segment of path.split(".")) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor)) {
      // `length` reads naturally in an assertion — "two Pieces were made" —
      // and is the only non-index property worth exposing here.
      if (segment === "length") {
        cursor = cursor.length;
        continue;
      }
      const index = Number(segment);
      cursor = Number.isInteger(index) ? cursor[index] : undefined;
      continue;
    }
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Compare loosely enough to be worth writing.
 *
 * An author asserting `counters.streak: 1` should not have to care that the
 * engine stores it as a number and YAML parsed it as one too; but they also
 * should not be able to pass by asserting `"1"`. So: structural equality, no
 * type coercion.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function runFixture(pack: Pack, fixture: Pack["fixtures"] extends (infer F)[] | undefined ? F : never): FixtureResult {
  try {
    const events = normalize(pack, fixture.events);
    // A fixture may name a mode; the reducer takes it from the RunStarted
    // event, which `normalize` has already defaulted.
    if (fixture.mode) {
      const first = events[0] as unknown as Record<string, unknown> | undefined;
      if (first && first.t === "RunStarted") first.mode = fixture.mode;
    }
    if (fixture.seed) {
      const first = events[0] as unknown as Record<string, unknown> | undefined;
      if (first && first.t === "RunStarted") first.seed ??= fixture.seed;
    }

    const state = reduce(pack, events);
    const assertions = fixture.expect.map(({ path, equals }) => {
      const actual = readPath(state, path);
      return { path, expected: equals, actual, ok: same(actual, equals) };
    });

    return { name: fixture.name, ok: assertions.every((a) => a.ok), assertions };
  } catch (e) {
    // A fixture whose log the reducer refuses is a failing fixture, not a
    // crashed CLI: an author needs to see which one and why.
    return {
      name: fixture.name,
      ok: false,
      assertions: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function runFixtures(pack: Pack): FixtureResult[] {
  return (pack.fixtures ?? []).map((f) => runFixture(pack, f));
}
