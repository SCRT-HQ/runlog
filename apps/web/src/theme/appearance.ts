import {
  BUILTIN_PRESETS,
  createThemeRecordFromPreset,
  parsePresentationSnapshot,
  presentationSnapshotKey,
  resolveThemeRecord,
  snapshotToResolvedColors,
  type PresentationSnapshotV1,
  type ThemeValidationResult,
} from "@runlog/themes";
import { applyPresentation, clearPresentation, compilePresentation, type PresentationScope } from "./presentation.ts";
import { isThemeId, savedTheme, type ThemeId } from "./theme.ts";

export type BootAppearanceV1 =
  | { readonly schemaVersion: 1; readonly mode: "system" }
  | { readonly schemaVersion: 1; readonly mode: "snapshot"; readonly snapshot: PresentationSnapshotV1 };

export type AppearanceStorage = Pick<Storage, "getItem" | "setItem">;

export const APPEARANCE_KEY = "runlog.appearance.v1";

const LEGACY_THEME_KEY = "runlog.theme";
const MAX_STORED_BYTES = 65_536;
const ENVELOPE_KEYS = ["schemaVersion", "mode", "snapshot"] as const;
const NESTED_FEEDBACK_PROPERTIES = ["--success-background", "--warning-background", "--danger-background"] as const;
const SYSTEM_APPEARANCE: BootAppearanceV1 = Object.freeze({ schemaVersion: 1, mode: "system" });

function valid<T>(value: T): ThemeValidationResult<T> {
  return Object.freeze({ ok: true, value });
}

function invalid<T = never>(path: string, message: string): ThemeValidationResult<T> {
  return Object.freeze({
    ok: false,
    issues: Object.freeze([Object.freeze({ path, message })]),
  });
}

function readEnvelope(input: unknown): ThemeValidationResult<Readonly<Record<string, unknown>>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalid("$", "Expected a plain data record");
  }

  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(input);
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch {
    return invalid("$", "Unable to inspect data record");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid("$", "Expected an ordinary or null prototype");
  }

  const allowed = new Set<string>(ENVELOPE_KEYS);
  const values: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return invalid("$", "Symbol properties are not allowed");
    if (!allowed.has(key)) return invalid(`$.${key}`, "Unknown field");
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) return invalid(`$.${key}`, "Accessors are not allowed");
    if (!descriptor.enumerable) return invalid(`$.${key}`, "Non-enumerable properties are not allowed");
    values[key] = descriptor.value;
  }
  for (const key of ["schemaVersion", "mode"] as const) {
    if (!Object.hasOwn(values, key)) return invalid(`$.${key}`, "Required field is missing");
  }
  return valid(Object.freeze(values));
}

export function parseBootAppearance(value: unknown): ThemeValidationResult<BootAppearanceV1> {
  const envelope = readEnvelope(value);
  if (!envelope.ok) return envelope;
  if (envelope.value.schemaVersion !== 1) return invalid("$.schemaVersion", "Unsupported schema version");

  if (envelope.value.mode === "system") {
    if (Object.hasOwn(envelope.value, "snapshot")) return invalid("$.snapshot", "System appearance cannot contain a snapshot");
    return valid(SYSTEM_APPEARANCE);
  }
  if (envelope.value.mode !== "snapshot") return invalid("$.mode", "Expected system or snapshot");
  if (!Object.hasOwn(envelope.value, "snapshot")) return invalid("$.snapshot", "Required field is missing");

  const snapshot = parsePresentationSnapshot(envelope.value.snapshot);
  if (!snapshot.ok) {
    const issue = snapshot.issues[0];
    const suffix = issue?.path === "$" ? "" : (issue?.path.slice(1) ?? "");
    return invalid(`$.snapshot${suffix}`, issue?.message ?? "Invalid presentation snapshot");
  }
  return valid(Object.freeze({ schemaVersion: 1, mode: "snapshot", snapshot: snapshot.value }));
}

function requestedStorage(storage: AppearanceStorage | null | undefined): AppearanceStorage | null {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readItem(storage: AppearanceStorage, key: string): string | null | undefined {
  try {
    const value = storage.getItem(key);
    return value === null || typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function storedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function readBootAppearance(storage?: AppearanceStorage | null): BootAppearanceV1 {
  const target = requestedStorage(storage);
  if (target === null) return SYSTEM_APPEARANCE;

  const stored = readItem(target, APPEARANCE_KEY);
  if (stored === undefined) return SYSTEM_APPEARANCE;
  if (stored !== null) {
    if (storedByteLength(stored) > MAX_STORED_BYTES) return SYSTEM_APPEARANCE;
    try {
      const parsed = parseBootAppearance(JSON.parse(stored));
      return parsed.ok ? parsed.value : SYSTEM_APPEARANCE;
    } catch {
      return SYSTEM_APPEARANCE;
    }
  }

  const legacy = storage === undefined ? savedTheme() : readItem(target, LEGACY_THEME_KEY);
  if (legacy === undefined || !isThemeId(legacy) || legacy === "system") return SYSTEM_APPEARANCE;
  return Object.freeze({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin(legacy) });
}

export function writeBootAppearance(value: BootAppearanceV1, storage?: AppearanceStorage | null): void {
  const parsed = parseBootAppearance(value);
  if (!parsed.ok) throw new TypeError(`Invalid boot appearance at ${parsed.issues[0]?.path ?? "$"}`);

  const target = requestedStorage(storage);
  if (target === null) throw new Error("Appearance storage is unavailable");
  const serialized =
    parsed.value.mode === "system"
      ? JSON.stringify(parsed.value)
      : `{"schemaVersion":1,"mode":"snapshot","snapshot":${presentationSnapshotKey(parsed.value.snapshot)}}`;
  try {
    target.setItem(APPEARANCE_KEY, serialized);
  } catch (cause) {
    throw new Error("Unable to save appearance", { cause });
  }
}

export function snapshotForBuiltin(id: Exclude<ThemeId, "system">): PresentationSnapshotV1 {
  if (!isThemeId(id)) throw new TypeError("Expected a built-in theme id");
  const preset = BUILTIN_PRESETS.find((candidate) => candidate.id === id);
  if (preset === undefined) throw new TypeError("Expected a built-in theme id");
  const record = createThemeRecordFromPreset({ id: preset.id, name: preset.label, presetId: preset.id });
  if (!record.ok) throw new Error(`Unable to create built-in theme record for ${id}`);
  const snapshot = resolveThemeRecord(record.value);
  if (!snapshot.ok) throw new Error(`Unable to resolve built-in theme record for ${id}`);
  return snapshot.value;
}

export function applyBootAppearance(value: BootAppearanceV1, root: HTMLElement, scope: PresentationScope = "app"): void {
  const parsed = parseBootAppearance(value);
  if (!parsed.ok) throw new TypeError(`Invalid boot appearance at ${parsed.issues[0]?.path ?? "$"}`);

  if (parsed.value.mode === "system") {
    clearPresentation(root);
    root.removeAttribute("data-theme");
    return;
  }

  const snapshot = parsed.value.snapshot;
  const presentation = compilePresentation(snapshotToResolvedColors(snapshot), snapshot.fonts, snapshot.colorScheme, scope);
  applyPresentation(presentation, root);
  if (root !== root.ownerDocument.documentElement) {
    for (const property of NESTED_FEEDBACK_PROPERTIES) {
      if (presentation[property] === null) root.style.setProperty(property, "initial");
    }
  }
  root.removeAttribute("data-theme");
}

export function isThemeRecoveryAddress(address: string): boolean {
  return address === "#themes/recovery";
}
