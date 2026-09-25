import type { LookActionResult } from "./publisher.ts";

/** A theme link action a person can take from the Stream panel or the profile. */
export type LookAction = "create" | "takeOver" | "revoke";

const FAILED: Record<LookAction, string> = {
  create: "Could not make the theme link. Try again.",
  takeOver: "Could not move the theme link to this device. Try again.",
  revoke: "Could not revoke the theme link. Try again.",
};

/** The plain line for an action that did not happen; a new link counts as making one. */
export function lookActionProblem(action: LookAction, result: Exclude<LookActionResult, "ok">): string {
  if (result === "plan") return "Following this device from anywhere is part of Plus.";
  if (result === "full") return "This account has as many theme links as it can hold. Revoke one on your profile, under Streaming.";
  return FAILED[action];
}
