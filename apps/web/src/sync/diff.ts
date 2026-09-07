/**
 * What to do about each thing, given what is here and what is there.
 *
 * Two-way and per item. Logs are only ever replaced whole, never merged — the
 * same rule `loadEvents` already keeps, because half of one run and half of
 * another is not a run. So the question per item is only: which side is
 * newer, and has either side deleted it?
 *
 * Newer wins by `updatedAt`. ISO strings, so lexical order is chronological.
 * That one rule is also what makes undo survive a sync: an undo is a shorter
 * log with a newer stamp, so it travels as "newer", not as "less". A tie is
 * pushed, deterministically; the only way to get one is the same device.
 *
 * A deletion travels unless the other side wrote after it — someone who kept
 * working on a run they did not know was forgotten elsewhere keeps it.
 */

export interface Entry {
  id: string;
  updatedAt: string;
  /** A fingerprint of the body, for "nothing to do". Not integrity. */
  hash: string;
  deletedAt?: string;
}

export interface Plan {
  /** Send mine. */
  push: string[];
  /** Take theirs. */
  pull: string[];
  /** Drop my copy: they deleted it after I last wrote. */
  forgetLocal: string[];
  /** Tell them to delete: I deleted it after they last wrote. */
  deleteRemote: string[];
  /** Both sides agree it is gone; the tombstone can go for good. */
  purge: string[];
}

export function diff(local: Entry[], remote: Entry[]): Plan {
  const plan: Plan = { push: [], pull: [], forgetLocal: [], deleteRemote: [], purge: [] };
  const mine = new Map(local.map((e) => [e.id, e]));
  const theirs = new Map(remote.map((e) => [e.id, e]));

  for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
    const l = mine.get(id);
    const r = theirs.get(id);

    if (l?.deletedAt) {
      if (r?.deletedAt) plan.purge.push(id);
      else if (!r || r.updatedAt <= l.deletedAt) plan.deleteRemote.push(id);
      else plan.pull.push(id); // they kept working: the run comes back
      continue;
    }
    if (r?.deletedAt) {
      if (!l || l.updatedAt <= r.deletedAt) plan.forgetLocal.push(id);
      else plan.push.push(id); // I kept working: mine stands
      continue;
    }
    if (!r) {
      plan.push.push(id);
      continue;
    }
    if (!l) {
      plan.pull.push(id);
      continue;
    }
    if (l.hash === r.hash) continue;
    if (l.updatedAt >= r.updatedAt) plan.push.push(id);
    else plan.pull.push(id);
  }
  return plan;
}
