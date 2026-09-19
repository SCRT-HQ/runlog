import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../auth/Account.tsx";
import { useApi } from "./useApi.ts";
import { PlanContext, accessFor, type Plan, type PlanState } from "./usePlan.ts";

type OwnedPlanState = Extract<PlanState, { ownerId: string }>;
type StoredPlanState = { lifecycle: object; state: OwnedPlanState };
type Lifecycle = {
  accountStatus: ReturnType<typeof useAccount>["status"];
  ownerId: string | null;
  api: ReturnType<typeof useApi>;
  token: object;
};

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
  const [stored, setStored] = useState<StoredPlanState | null>(null);
  const ownerId = account.status === "signed-in" ? account.user.id : null;
  const lifecycleRef = useRef<Lifecycle>({ accountStatus: account.status, ownerId, api, token: {} });
  const generationRef = useRef(0);

  if (
    lifecycleRef.current.accountStatus !== account.status ||
    lifecycleRef.current.ownerId !== ownerId ||
    lifecycleRef.current.api !== api
  ) {
    lifecycleRef.current = { accountStatus: account.status, ownerId, api, token: {} };
    generationRef.current += 1;
  }
  const lifecycle = lifecycleRef.current.token;

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
        return stored !== null && stored.lifecycle === lifecycle && stored.state.ownerId === currentOwner
          ? stored.state
          : { kind: "loading", ownerId: currentOwner };
      }
    }
  })();

  const refresh = useCallback(async () => {
    if (account.status !== "signed-in" || api === null) return;
    if (lifecycleRef.current.token !== lifecycle) return;
    const requestedOwner = account.user.id;
    const requestedApi = api;
    const requestedLifecycle = lifecycle;
    const generation = ++generationRef.current;
    setStored({ lifecycle: requestedLifecycle, state: { kind: "loading", ownerId: requestedOwner } });

    const current = () =>
      lifecycleRef.current.token === requestedLifecycle &&
      lifecycleRef.current.ownerId === requestedOwner &&
      lifecycleRef.current.api === requestedApi &&
      generationRef.current === generation;
    try {
      const me = await requestedApi.me();
      if (!current()) return;
      if (me.sub !== requestedOwner || !completeCapabilities(me.capabilities)) {
        setStored({
          lifecycle: requestedLifecycle,
          state: { kind: "error", ownerId: requestedOwner, message: "The plan response did not match this account." },
        });
        return;
      }
      setStored({
        lifecycle: requestedLifecycle,
        state: {
          kind: "ready",
          ownerId: requestedOwner,
          gates: me.gates === true,
          capabilities: me.capabilities,
          offers: {
            servers: me.servers === true,
            serversOpen: me.serversOpen === true,
            publishersOpen: me.publishersOpen !== false,
          },
        },
      });
    } catch (error) {
      if (!current()) return;
      setStored({
        lifecycle: requestedLifecycle,
        state: {
          kind: "error",
          ownerId: requestedOwner,
          message: error instanceof Error ? error.message : "The plan could not be checked.",
        },
      });
    }
  }, [account, api, lifecycle]);

  useEffect(() => {
    if (account.status === "signed-in" && api !== null) void refresh();
  }, [account.status, account.status === "signed-in" ? account.user.id : null, api, refresh]);

  const plan = useMemo<Plan>(
    () => ({ state: visible, access: (capability) => accessFor(visible, capability), refresh }),
    [visible, refresh],
  );
  return <PlanContext.Provider value={plan}>{children}</PlanContext.Provider>;
}
