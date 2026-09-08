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
const listeners = new Set<(p: Profile | null) => void>();

export function rememberProfile(profile: Profile | null): void {
  cached = profile;
  for (const l of listeners) l(profile);
}

/** For sign-out and tests: forget what was known. */
export function forgetProfile(): void {
  rememberProfile(null);
}

export function useProfile(): { profile: Profile | null; loaded: boolean; refresh: () => Promise<void> } {
  const api = useApi();
  const [profile, setProfile] = useState(cached);
  const [loaded, setLoaded] = useState(cached !== null);

  useEffect(() => {
    listeners.add(setProfile);
    return () => {
      listeners.delete(setProfile);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const me = await api.me();
      rememberProfile(me.profile);
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

  return { profile, loaded, refresh };
}
