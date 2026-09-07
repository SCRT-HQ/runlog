/**
 * When each pack was last brought into play on this device.
 *
 * The library's order. A fact about this device, not the account: what
 * you played last on your phone is not what you played last on the laptop,
 * and neither should reorder the other. Kept as one small map in
 * localStorage beside the open-run records.
 */

const KEY = "runlog:opened";

function read(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function openedAt(packId: string): string | null {
  return read()[packId] ?? null;
}

export function markOpened(packId: string, at = new Date().toISOString()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [packId]: at }));
  } catch {
    /* a private window: the order lasts the tab */
  }
}

export function forgetOpened(packId: string): void {
  try {
    const { [packId]: _gone, ...rest } = read();
    localStorage.setItem(KEY, JSON.stringify(rest));
  } catch {
    /* nothing to do */
  }
}

/** Newest-played first; never-played after, in the order given. */
export function byLastOpened<T extends { id: string }>(packs: readonly T[]): T[] {
  const map = read();
  return [...packs].sort((a, b) => {
    const x = map[a.id] ?? "";
    const y = map[b.id] ?? "";
    return x === y ? 0 : x > y ? -1 : 1;
  });
}
