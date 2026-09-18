import { isColorTokenId, parseThemeRecord, type ColorTokenId, type ThemeRecordV1, type ThemeValidationResult } from "@runlog/themes";

export interface ThemeDraftV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly sourceThemeId: string | null;
  readonly baseLocalRevision: number | null;
  readonly record: ThemeRecordV1;
  readonly rawName: string;
  readonly rawColors: Readonly<Partial<Record<ColorTokenId, string>>>;
}

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const DRAFT_KEYS = ["schemaVersion", "id", "sourceThemeId", "baseLocalRevision", "record", "rawName", "rawColors"] as const;

function valid<T>(value: T): ThemeValidationResult<T> {
  return Object.freeze({ ok: true, value });
}

function invalid<T = never>(path: string, message: string): ThemeValidationResult<T> {
  return Object.freeze({
    ok: false,
    issues: Object.freeze([Object.freeze({ path, message })]),
  });
}

function readDataRecord(
  input: unknown,
  path: string,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[] = allowedKeys,
): ThemeValidationResult<Readonly<Record<string, unknown>>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalid(path, "Expected a plain data record");
  }

  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(input);
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch {
    return invalid(path, "Unable to inspect data record");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(path, "Expected an ordinary or null prototype");
  }

  const allowed = new Set(allowedKeys);
  const values: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return invalid(path, "Symbol properties are not allowed");
    if (!allowed.has(key)) return invalid(`${path}.${key}`, "Unknown field");
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) return invalid(`${path}.${key}`, "Accessors are not allowed");
    if (!descriptor.enumerable) return invalid(`${path}.${key}`, "Non-enumerable properties are not allowed");
    values[key] = descriptor.value;
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(values, key)) return invalid(`${path}.${key}`, "Required field is missing");
  }
  return valid(Object.freeze(values));
}

function parseIdentifier(input: unknown, path: string): ThemeValidationResult<string> {
  return typeof input === "string" && IDENTIFIER.test(input) ? valid(input) : invalid(path, "Invalid identifier");
}

function boundedString(input: unknown, path: string): ThemeValidationResult<string> {
  if (typeof input !== "string") return invalid(path, "Expected a string");
  return Array.from(input).length <= 1024 ? valid(input) : invalid(path, "Expected at most 1024 Unicode code points");
}

function parseRawColors(input: unknown): ThemeValidationResult<ThemeDraftV1["rawColors"]> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalid("$.rawColors", "Expected a plain data record");
  }
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(input);
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch {
    return invalid("$.rawColors", "Unable to inspect data record");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid("$.rawColors", "Expected an ordinary or null prototype");
  }

  const colors: Partial<Record<ColorTokenId, string>> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return invalid("$.rawColors", "Symbol properties are not allowed");
    if (!isColorTokenId(key)) return invalid(`$.rawColors.${key}`, "Unknown color role");
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      return invalid(`$.rawColors.${key}`, "Accessors are not allowed");
    }
    if (!descriptor.enumerable) return invalid(`$.rawColors.${key}`, "Non-enumerable properties are not allowed");
    const value = boundedString(descriptor.value, `$.rawColors.${key}`);
    if (!value.ok) return value;
    colors[key] = value.value;
  }
  return valid(Object.freeze(colors));
}

export function parseThemeDraft(input: unknown): ThemeValidationResult<ThemeDraftV1> {
  const data = readDataRecord(input, "$", DRAFT_KEYS);
  if (!data.ok) return data;
  if (data.value.schemaVersion !== 1) return invalid("$.schemaVersion", "Unsupported schema version");

  const id = parseIdentifier(data.value.id, "$.id");
  if (!id.ok) return id;
  const sourceThemeId =
    data.value.sourceThemeId === null ? valid<null>(null) : parseIdentifier(data.value.sourceThemeId, "$.sourceThemeId");
  if (!sourceThemeId.ok) return sourceThemeId;
  const rawName = boundedString(data.value.rawName, "$.rawName");
  if (!rawName.ok) return rawName;
  const rawColors = parseRawColors(data.value.rawColors);
  if (!rawColors.ok) return rawColors;
  const record = parseThemeRecord(data.value.record);
  if (!record.ok) return record;

  let baseLocalRevision: number | null;
  if (sourceThemeId.value === null) {
    if (data.value.baseLocalRevision !== null) {
      return invalid("$.baseLocalRevision", "New-theme drafts require a null base revision");
    }
    baseLocalRevision = null;
  } else {
    if (!Number.isSafeInteger(data.value.baseLocalRevision) || (data.value.baseLocalRevision as number) <= 0) {
      return invalid("$.baseLocalRevision", "Expected a positive safe integer");
    }
    if (record.value.id !== sourceThemeId.value) {
      return invalid("$.record.id", "Record id must match source theme id");
    }
    baseLocalRevision = data.value.baseLocalRevision as number;
  }

  return valid(
    Object.freeze({
      schemaVersion: 1,
      id: id.value,
      sourceThemeId: sourceThemeId.value,
      baseLocalRevision,
      record: record.value,
      rawName: rawName.value,
      rawColors: rawColors.value,
    }),
  );
}
