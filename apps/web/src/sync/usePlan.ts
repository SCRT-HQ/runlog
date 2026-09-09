import { useCallback, useEffect, useState } from "react";
import { useApi } from "./useApi.ts";

/**
 * Which plan this account is on, as the server sees it.
 *
 * Two facts: whether plans gate anything on this address, and which
 * features the account is entitled to. Both come from `GET /api/me`, read
 * once per page and again on request, after a Checkout comes back, say.
 * Where plans are off, `can` is true for everything, so nothing in the app
 * has to know whether it is running in preview or for real.
 */

export interface Plan {
  gates: boolean;
  entitlements: string[];
  /** Whether the account may use a feature: yes where nothing is gated, else by entitlement. */
  can: (feature: string) => boolean;
  /**
   * Whether this copy offers the server tier at all: there is a bot to use
   * it with. Not a gate, an offer, so it is false where nothing is known
   * rather than true the way `can` is.
   */
  servers: boolean;
  /**
   * Whether a tier is on sale today: the server tier, and becoming a
   * publisher with hosted licensing. A tier can be held back by a flag
   * the operator flips, so a page shows it as coming rather than offering
   * Checkout. True until known, so nothing flickers shut on the way in.
   */
  serversOpen: boolean;
  publishersOpen: boolean;
  loaded: boolean;
  refresh: () => Promise<void>;
}

let cached: { gates: boolean; entitlements: string[]; servers: boolean; serversOpen: boolean; publishersOpen: boolean } | null = null;

export function usePlan(): Plan {
  const api = useApi();
  const [state, setState] = useState(cached);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const me = await api.me();
      cached = { gates: me.gates === true, entitlements: me.entitlements ?? [], servers: me.servers === true, serversOpen: me.serversOpen === true, publishersOpen: me.publishersOpen !== false };
      setState(cached);
    } catch {
      // Offline, or signed out between renders: what was known stands.
    }
  }, [api]);

  useEffect(() => {
    if (api && !cached) void refresh();
  }, [api, refresh]);

  const gates = state?.gates ?? false;
  const entitlements = state?.entitlements ?? [];
  return {
    gates,
    entitlements,
    can: (feature) => !gates || entitlements.includes(feature),
    servers: state?.servers ?? false,
    serversOpen: state?.serversOpen ?? false,
    publishersOpen: state?.publishersOpen ?? true,
    loaded: state !== null,
    refresh,
  };
}

/** For tests, and for sign-out: forget what was known. */
export function forgetPlan(): void {
  cached = null;
}
