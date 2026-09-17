import { useCallback, useEffect, useState } from "react";
import type { Profile } from "./client.ts";
import { useApi } from "./useApi.ts";

/**
 * This account's profile, as the server holds it, shared by everything
 * that shows a name: the menu's label, the gate that asks for one, the
 * profile page. Read once per page from `GET /api/me`; anything that
 * writes the profile hands the answer back through `rememberProfile`, so
 * a name chosen in one place is the name everywhere at once.
 */

let cached: Profile | null = null;
/** Whether another account holds the name this one shows, as the last read said. */
let taken = false;
const listeners = new Set<(p: Profile | null) => void>();
const takenListeners = new Set<(t: boolean) => void>();

/**
 * Keep what the server just said. A write that carried a name the server
 * accepted says `false`: the claim is this account's. A write about
 * something else leaves what the last read said standing.
 */
export function rememberProfile(profile: Profile | null, handleTaken = taken): void {
  cached = profile;
  taken = handleTaken;
  for (const l of listeners) l(profile);
  for (const l of takenListeners) l(handleTaken);
}

/** For sign-out and tests: forget what was known. */
export function forgetProfile(): void {
  rememberProfile(null, false);
}

export function useProfile(): { profile: Profile | null; loaded: boolean; handleTaken: boolean; refresh: () => Promise<void> } {
  const api = useApi();
  const [profile, setProfile] = useState(cached);
  const [handleTaken, setHandleTaken] = useState(taken);
  const [loaded, setLoaded] = useState(cached !== null);

  useEffect(() => {
    listeners.add(setProfile);
    takenListeners.add(setHandleTaken);
    return () => {
      listeners.delete(setProfile);
      takenListeners.delete(setHandleTaken);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const me = await api.me();
      rememberProfile(me.profile, me.handleTaken === true);
      setLoaded(true);
    } catch {
      // Offline, or signed out between renders: what was known stands.
    }
  }, [api]);

  useEffect(() => {
    if (!api) {
      setLoaded(false);
      return;
    }
    if (!cached) void refresh();
    else setLoaded(true);
  }, [api, refresh]);

  return { profile, loaded, handleTaken, refresh };
}
