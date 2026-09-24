import type { ThemeItemStatus, ThemeSyncNotice, ThemeSyncPhase } from "./worker.ts";

export interface ThemeSyncView {
  /** device: a guest, a file build or no API; off: signed in with this device's Sync switch off; on: syncing. */
  readonly mode: "device" | "off" | "on";
  readonly phase: ThemeSyncPhase;
  readonly items: ReadonlyMap<string, ThemeItemStatus>;
  readonly notices: readonly ThemeSyncNotice[];
  retry(): void;
  dismissNotice(index: number): void;
  /** Call while the library is on screen; the returned function stops the 30-second pull. */
  watchLibrary(): () => void;
}

const NO_ITEMS: ReadonlyMap<string, ThemeItemStatus> = new Map();

export const DEVICE_ONLY_SYNC: ThemeSyncView = Object.freeze({
  mode: "device",
  phase: "idle",
  items: NO_ITEMS,
  notices: Object.freeze([]),
  retry: () => {},
  dismissNotice: () => {},
  watchLibrary: () => () => {},
});
