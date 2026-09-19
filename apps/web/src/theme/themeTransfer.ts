import { parseThemeRecord, type ThemeRecordV1, type ThemeValidationIssue, type ThemeValidationResult } from "@runlog/themes";

const MAX_IMPORT_BYTES = 65_536;

function invalid(path: string, message: string): ThemeValidationResult<ThemeRecordV1> {
  const issue: ThemeValidationIssue = Object.freeze({ path, message });
  return Object.freeze({ ok: false, issues: Object.freeze([issue]) });
}

function validationError(issues: readonly ThemeValidationIssue[]): TypeError {
  const detail = issues.map(({ path, message }) => `${path}: ${message}`).join("; ");
  return new TypeError(`Invalid portable theme record: ${detail}`);
}

export function importThemeJson(text: string, newId: string): ThemeValidationResult<ThemeRecordV1> {
  if (typeof text !== "string") return invalid("$", "Expected JSON text");
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    return invalid("$", "Theme JSON exceeds 65,536 UTF-8 bytes");
  }

  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return invalid("$", "Invalid JSON");
  }

  const imported = parseThemeRecord(input);
  if (!imported.ok) return imported;
  return parseThemeRecord({ ...imported.value, id: newId, contentRevision: 1 });
}

export function exportThemeJson(input: ThemeRecordV1): string {
  const record = parseThemeRecord(input);
  if (!record.ok) throw validationError(record.issues);
  return JSON.stringify(record.value, null, 2);
}
