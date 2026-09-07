/**
 * Which run this device has open.
 *
 * Per pack, the run that Play shows for it; and overall, the run this
 * device touched last, which is the one to return to and the one another
 * device with nothing open should start from. Both live in localStorage
 * beside the sync switch: they are facts about this device, not about the
 * account, and they must survive a reload but never travel.
 *
 * Nothing here clears itself. Browsing another pack, the profile, or
 * Inspect leaves the active run where it was; only starting another,
 * switching, or discarding moves it.
 */

const PER_PACK = "runlog:active:";
const LAST = "runlog:active";

/**
 * Stored in a pack's slot when the player asked for a fresh run and has not
 * started it: setup shows, and nothing arriving from elsewhere fills it.
 */
export const NEW_RUN = "new";

export interface LastActive {
  packId: string;
  runId: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The run open for this pack on this device, if one was chosen. */
export function activeRunFor(packId: string): string | null {
  return storage()?.getItem(PER_PACK + packId) ?? null;
}

export function setActiveRunFor(packId: string, runId: string | null): void {
  const s = storage();
  if (!s) return;
  if (runId) s.setItem(PER_PACK + packId, runId);
  else s.removeItem(PER_PACK + packId);
}

/** The run this device touched last, across every pack. */
export function lastActive(): LastActive | null {
  const raw = storage()?.getItem(LAST);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LastActive>;
    return typeof parsed.packId === "string" && typeof parsed.runId === "string"
      ? { packId: parsed.packId, runId: parsed.runId }
      : null;
  } catch {
    return null;
  }
}

export function setLastActive(last: LastActive | null): void {
  const s = storage();
  if (!s) return;
  if (last) s.setItem(LAST, JSON.stringify(last));
  else s.removeItem(LAST);
}

/** A run went away: forget it wherever it was the active one. */
export function forgetActive(packId: string, runId: string): void {
  if (activeRunFor(packId) === runId) setActiveRunFor(packId, null);
  if (lastActive()?.runId === runId) setLastActive(null);
}
