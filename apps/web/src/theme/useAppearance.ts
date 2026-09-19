import { useSyncExternalStore } from "react";
import { addressOf } from "../route.ts";
import {
  APPEARANCE_KEY,
  isThemeRecoveryAddress,
  parseBootAppearance,
  readBootAppearance,
  writeBootAppearance,
  type BootAppearanceV1,
} from "./appearance.ts";

const SYSTEM_APPEARANCE: BootAppearanceV1 = Object.freeze({ schemaVersion: 1, mode: "system" });
const listeners = new Set<() => void>();

function initialAppearance(): BootAppearanceV1 {
  let recovery = false;
  try {
    const configuredBase = import.meta.env.BASE_URL.startsWith("/") ? import.meta.env.BASE_URL : null;
    recovery = isThemeRecoveryAddress(addressOf(globalThis.location, configuredBase));
  } catch {
    // A non-browser render has no recovery address and no device storage.
  }
  return recovery ? SYSTEM_APPEARANCE : readBootAppearance();
}

let current = initialAppearance();

function publish(value: BootAppearanceV1): void {
  current = value;
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== APPEARANCE_KEY) return;
  publish(readBootAppearance());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) globalThis.window?.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) globalThis.window?.removeEventListener("storage", onStorage);
  };
}

function snapshot(): BootAppearanceV1 {
  return current;
}

export function useAppearance(): BootAppearanceV1 {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function setDeviceAppearance(value: BootAppearanceV1): void {
  const parsed = parseBootAppearance(value);
  if (!parsed.ok) throw new TypeError(`Invalid boot appearance at ${parsed.issues[0]?.path ?? "$"}`);
  writeBootAppearance(parsed.value);
  publish(parsed.value);
}
