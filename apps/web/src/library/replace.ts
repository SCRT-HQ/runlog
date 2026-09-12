import type { Pack } from "@runlog/rules-schema";
import type { StoredPack } from "../storage/db.ts";

/**
 * A pack from a file, kept: a new record where the shelf has no pack of
 * that id, and otherwise the same record with the new text in it.
 *
 * A pack's id is its identity everywhere: on the shelf, in the run index,
 * in the account's vault. So a file whose id is already here is that pack,
 * edited, and taking it means keeping what belongs to the record rather
 * than to the file: when it first arrived, and whether it travels to the
 * account. Runs are not touched at all. Each is stamped with the version it
 * was played under and reads whatever text is loaded now, which is the
 * same rule a marketplace update follows.
 *
 * Where the pack came from does not carry over. Text from a file is the
 * player's own now, so the marketplace is no longer asked for a newer one, and
 * a plain file in place of a sealed copy is a plain pack.
 */
export function keptFromFile(existing: StoredPack | null, pack: Pack, text: string, filename: string, at: string): StoredPack {
  const fresh: StoredPack = {
    id: pack.id,
    title: pack.title,
    version: pack.version,
    source: text,
    format: formatOf(filename),
    filename,
    importedAt: at,
    updatedAt: at,
  };
  if (!existing || existing.deletedAt) return fresh;
  return {
    ...fresh,
    importedAt: existing.importedAt,
    ...(existing.sync !== undefined ? { sync: existing.sync } : {}),
  };
}

export const formatOf = (filename: string): "yaml" | "json" => (/\.ya?ml$/i.test(filename) ? "yaml" : "json");

/** Why a file cannot stand in for this pack: it is a different pack. Null where it can. */
export function notThisPack(record: StoredPack, pack: Pack): string | null {
  if (pack.id === record.id) return null;
  return `That file is ${pack.title} (${pack.id}), not ${record.title}. To keep it as a pack of its own, use Load a pack from a file.`;
}

/** What to say once the new text is in: which versions, and that the runs stayed. */
export function replacedNotice(before: StoredPack, after: StoredPack, runs: string): string {
  const version = before.version === after.version ? `a new copy, still v${after.version}` : `v${after.version}`;
  return `${after.title}: v${before.version} replaced with ${version}. Its ${runs} are kept.`;
}
