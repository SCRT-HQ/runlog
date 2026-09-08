/**
 * How the log is read on this device: which end first, and how much of it.
 *
 * Newest first is the default, because a long run is read from the top.
 * A person following along, or writing the run up, wants it the other way,
 * and a person mid-run often wants only the last few lines rather than
 * every roll since the start. Both are kept on this device, like the
 * sounds; the log itself is the same either way.
 */
export type LogOrder = "newest" | "oldest";

const ORDER_KEY = "runlog:logOrder";
const LIMIT_KEY = "runlog:logLimit";

/** The choices for how many lines to show; 0 is all of them. */
export const LOG_LIMITS = [0, 6, 12, 24] as const;

export function logOrder(): LogOrder {
  try {
    return localStorage.getItem(ORDER_KEY) === "oldest" ? "oldest" : "newest";
  } catch {
    return "newest";
  }
}

export function setLogOrder(order: LogOrder): void {
  try {
    if (order === "oldest") localStorage.setItem(ORDER_KEY, "oldest");
    else localStorage.removeItem(ORDER_KEY);
  } catch {
    /* the choice lasts the tab */
  }
}

export function logLimit(): number {
  try {
    const n = Number(localStorage.getItem(LIMIT_KEY) ?? 0);
    return (LOG_LIMITS as readonly number[]).includes(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function setLogLimit(limit: number): void {
  try {
    if (limit > 0) localStorage.setItem(LIMIT_KEY, String(limit));
    else localStorage.removeItem(LIMIT_KEY);
  } catch {
    /* the choice lasts the tab */
  }
}

/**
 * The lines to show, each with the number it has in the whole log. The
 * limit keeps the most recent lines whichever way they are ordered: "the
 * last six" means the same six, read either way.
 */
export function logLines<T>(outcomes: readonly T[], order: LogOrder, limit: number): Array<{ index: number; outcome: T }> {
  const all = outcomes.map((outcome, i) => ({ index: i + 1, outcome }));
  const kept = limit > 0 && all.length > limit ? all.slice(all.length - limit) : all;
  return order === "newest" ? kept.reverse() : kept;
}
