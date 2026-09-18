export interface ThemeValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type ThemeValidationResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly ThemeValidationIssue[] };

export function valid<T>(value: T): ThemeValidationResult<T> {
  return Object.freeze({ ok: true, value });
}

export function invalid<T = never>(path: string, message: string): ThemeValidationResult<T> {
  return Object.freeze({
    ok: false,
    issues: Object.freeze([Object.freeze({ path, message })]),
  });
}

export function readDataRecord(
  input: unknown,
  path: string,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[] = [],
): ThemeValidationResult<Readonly<Record<string, unknown>>> {
  if (typeof input !== "object" || input === null) {
    return invalid(path, "Expected a plain data record");
  }

  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    if (Array.isArray(input)) return invalid(path, "Expected a plain data record");
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
    if (descriptor === undefined || !("value" in descriptor)) {
      return invalid(`${path}.${key}`, "Accessors are not allowed");
    }
    if (!descriptor.enumerable) return invalid(`${path}.${key}`, "Non-enumerable properties are not allowed");
    values[key] = descriptor.value;
  }

  for (const key of requiredKeys) {
    if (!Object.hasOwn(values, key)) return invalid(`${path}.${key}`, "Required field is missing");
  }

  return valid(Object.freeze(values));
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
