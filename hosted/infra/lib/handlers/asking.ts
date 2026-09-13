/**
 * How often the outside may ask a run for something.
 *
 * One ask a name every twenty seconds, thirty a minute for the run,
 * whatever chat is doing. Kept per container; a second container starts
 * its own count, which is generous rather than wrong. What it guards is
 * the host's tray, not a budget.
 *
 * It lives here rather than beside either caller because there are two of
 * them now: an ask pressed over HTTP, and one a tool attached to the game
 * raised by saying what happened. Two limiters would have been two
 * different answers to the same question.
 */
const ASK_NAME_EVERY_MS = 20_000;
const ASK_RUN_PER_MINUTE = 30;
const askRates = new Map<string, { names: Map<string, number>; minute: number[] }>();

/**
 * Whether this ask may be taken, and when it may be if not.
 *
 * The wait comes back with the refusal because whoever pressed is owed a
 * number, not the rule: "eleven seconds" is something chat can act on,
 * "one a name every twenty seconds" is something to argue with.
 */
export function askAllowed(runId: string, name: string, atMs: number): { ok: true } | { ok: false; waitMs: number } {
  const r = askRates.get(runId) ?? { names: new Map<string, number>(), minute: [] };
  r.minute = r.minute.filter((t) => atMs - t < 60_000);
  if (r.minute.length >= ASK_RUN_PER_MINUTE) {
    const oldest = r.minute[0] ?? atMs;
    return { ok: false, waitMs: Math.max(1000, 60_000 - (atMs - oldest)) };
  }
  const last = r.names.get(name);
  if (last !== undefined && atMs - last < ASK_NAME_EVERY_MS) return { ok: false, waitMs: ASK_NAME_EVERY_MS - (atMs - last) };
  r.names.set(name, atMs);
  r.minute.push(atMs);
  if (r.names.size > 500) for (const [n, t] of r.names) if (atMs - t > ASK_NAME_EVERY_MS) r.names.delete(n);
  askRates.set(runId, r);
  return { ok: true };
}
