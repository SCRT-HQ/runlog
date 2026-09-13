/**
 * The names a tool will match a frame against.
 *
 * Four hundred graces, nine hundred items, five hundred weapons: too
 * many for a menu in a definitions file, and exactly the thing somebody
 * writing a rule cannot be expected to spell from memory. They are kept
 * out of `catalog.ts` and fetched when the panel that needs them opens,
 * so nobody who never writes a control rule downloads them.
 *
 * They come from the tool's own resources, by
 * `scripts/extract-tool-lists.py`, which means a name offered here is a
 * name the tool accepts: the panel is reading the same list the frame
 * will be matched against.
 */

export interface Named {
  name: string;
  /** A grace's region, which is the only thing telling two of the same name apart. */
  area?: string;
  /** A weapon's own ceiling: +25 on smithing stones, +10 on somber ones. */
  max?: number;
}

export type Lists = Record<string, Named[]>;

const loaded = new Map<string, Promise<Lists>>();

/**
 * The lists for one tool, fetched once.
 *
 * A tool with none is not an error: a profile written against nothing in
 * particular has no lists to offer and the fields stay as they were.
 */
export function listsFor(tool: string | undefined): Promise<Lists> {
  if (tool !== "TarnishedTool") return Promise.resolve({});
  const held = loaded.get(tool);
  if (held) return held;
  const asked = import("./lists/tarnishedtool.json")
    .then((m) => {
      const raw = (m.default ?? m) as { graces?: Named[]; items?: string[]; weapons?: Named[]; ashes?: Named[]; bosses?: Named[] };
      return {
        graces: raw.graces ?? [],
        items: (raw.items ?? []).map((name) => ({ name })),
        weapons: raw.weapons ?? [],
        ashes: raw.ashes ?? [],
        bosses: raw.bosses ?? [],
      } satisfies Lists;
    })
    .catch(() => ({}) as Lists);
  loaded.set(tool, asked);
  return asked;
}

/** Whether a typed name is one the tool knows, where the list is in hand. */
export function known(lists: Lists, list: string | undefined, name: unknown): boolean | null {
  if (!list) return null;
  const all = lists[list];
  if (!all || all.length === 0) return null;
  if (typeof name !== "string" || name.trim().length === 0) return null;
  const wanted = name.trim().toLowerCase();
  return all.some((n) => n.name.toLowerCase() === wanted);
}
