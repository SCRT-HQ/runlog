import { useMemo } from "react";
import { useAccount } from "../auth/Account.tsx";
import { createApi, type Api } from "./client.ts";
import { apiBase } from "./config.ts";

/**
 * The API, for a view that wants to ask it something directly.
 *
 * Null where there is nothing to ask: no client configured, or nobody
 * signed in. Views use it for the few things that are not sync, an
 * invitation, a member, the people list, and stay whole without it.
 */
export function useApi(): Api | null {
  const account = useAccount();
  const base = apiBase();
  return useMemo(
    () => (base && account.status === "signed-in" ? createApi(base, account.getAccessToken) : null),
    [base, account],
  );
}
