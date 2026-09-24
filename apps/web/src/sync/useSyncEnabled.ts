import { useSyncExternalStore } from "react";
import { subscribeSyncEnabled, syncEnabled } from "./config.ts";

const on = () => true;
const hearNothing = () => () => {};

/**
 * The device's one Sync switch, which runs, packs and themes all follow.
 * With `read` false it answers on without touching storage, for a caller with no account to sync.
 */
export function useSyncEnabled(read = true): boolean {
  return useSyncExternalStore(read ? subscribeSyncEnabled : hearNothing, read ? syncEnabled : on, on);
}
