import { createContext, useContext } from "react";
import { useAccount } from "../auth/Account.tsx";
import type { PlanCapabilities } from "./client.ts";

export type PlanCapability = keyof PlanCapabilities;
export type PlanAccess = "available" | "checking" | "sign-in" | "upgrade" | "error";

export type PlanState =
  | { kind: "local" }
  | { kind: "checking" }
  | { kind: "anonymous" }
  | { kind: "loading"; ownerId: string }
  | { kind: "error"; ownerId: string; message: string }
  | {
      kind: "ready";
      ownerId: string;
      gates: boolean;
      capabilities: PlanCapabilities;
      offers: { servers: boolean; serversOpen: boolean; publishersOpen: boolean };
    };

export interface Plan {
  state: PlanState;
  access(capability: PlanCapability): PlanAccess;
  refresh(): Promise<void>;
}

export const PlanContext = createContext<Plan | null>(null);

export function accessFor(state: PlanState, capability: PlanCapability): PlanAccess {
  switch (state.kind) {
    case "local":
      return "available";
    case "checking":
    case "loading":
      return "checking";
    case "anonymous":
      return "sign-in";
    case "error":
      return "error";
    case "ready":
      if (state.capabilities[capability]) return "available";
      if (!state.gates && (capability === "hostTables" || capability === "hostServers")) return "available";
      return "upgrade";
  }
}

const noRefresh = async () => {};

/**
 * The active account's shared plan snapshot.
 *
 * Tests that render a consumer without the application provider still get a
 * safe account-derived answer: local use stays open, and everything unknown
 * fails closed until a provider can ask the server.
 */
export function usePlan(): Plan {
  const plan = useContext(PlanContext);
  const account = useAccount();
  if (plan) return plan;

  const state: PlanState =
    account.status === "local"
      ? { kind: "local" }
      : account.status === "anonymous"
        ? { kind: "anonymous" }
        : account.status === "signed-in"
          ? { kind: "loading", ownerId: account.user.id }
          : { kind: "checking" };
  return { state, access: (capability) => accessFor(state, capability), refresh: noRefresh };
}
