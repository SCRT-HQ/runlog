import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../auth/Account.tsx";
import { useApi } from "./useApi.ts";
import { PlanContext, accessFor, type Plan, type PlanState } from "./usePlan.ts";

type OwnedPlanState = Extract<PlanState, { ownerId: string }>;

const completeCapabilities = (value: unknown): value is Extract<PlanState, { kind: "ready" }>["capabilities"] => {
  if (typeof value !== "object" || value === null) return false;
  const capabilities = value as Record<string, unknown>;
  return (
    typeof capabilities.hostTables === "boolean" &&
    typeof capabilities.waivePublisherFee === "boolean" &&
    typeof capabilities.hostServers === "boolean"
  );
};

export function PlanProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const api = useApi();
  const [stored, setStored] = useState<OwnedPlanState | null>(null);
  const ownerId = account.status === "signed-in" ? account.user.id : null;
  const ownerRef = useRef<string | null>(ownerId);
  const apiRef = useRef(api);
  const generationRef = useRef(0);

  if (ownerRef.current !== ownerId || apiRef.current !== api) {
    ownerRef.current = ownerId;
    apiRef.current = api;
    generationRef.current += 1;
  }

  const visible: PlanState = (() => {
    switch (account.status) {
      case "local":
        return { kind: "local" };
      case "checking":
        return { kind: "checking" };
      case "anonymous":
        return { kind: "anonymous" };
      case "signed-in": {
        const currentOwner = account.user.id;
        return stored !== null && stored.ownerId === currentOwner ? stored : { kind: "loading", ownerId: currentOwner };
      }
    }
  })();

  const refresh = useCallback(async () => {
    if (account.status !== "signed-in" || api === null) return;
    const requestedOwner = account.user.id;
    const requestedApi = api;
    const generation = ++generationRef.current;
    setStored({ kind: "loading", ownerId: requestedOwner });

    const current = () => ownerRef.current === requestedOwner && apiRef.current === requestedApi && generationRef.current === generation;
    try {
      const me = await requestedApi.me();
      if (!current()) return;
      if (me.sub !== requestedOwner || !completeCapabilities(me.capabilities)) {
        setStored({ kind: "error", ownerId: requestedOwner, message: "The plan response did not match this account." });
        return;
      }
      setStored({
        kind: "ready",
        ownerId: requestedOwner,
        gates: me.gates === true,
        capabilities: me.capabilities,
        offers: {
          servers: me.servers === true,
          serversOpen: me.serversOpen === true,
          publishersOpen: me.publishersOpen !== false,
        },
      });
    } catch (error) {
      if (!current()) return;
      setStored({
        kind: "error",
        ownerId: requestedOwner,
        message: error instanceof Error ? error.message : "The plan could not be checked.",
      });
    }
  }, [account, api]);

  useEffect(() => {
    if (account.status === "signed-in" && api !== null) void refresh();
  }, [account.status, account.status === "signed-in" ? account.user.id : null, api, refresh]);

  const plan = useMemo<Plan>(
    () => ({ state: visible, access: (capability) => accessFor(visible, capability), refresh }),
    [visible, refresh],
  );
  return <PlanContext.Provider value={plan}>{children}</PlanContext.Provider>;
}
