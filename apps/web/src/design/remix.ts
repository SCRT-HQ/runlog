/**
 * Starting a pack from another pack, where its license allows.
 *
 * A pack says two things about itself that matter here: whether its text
 * may be redistributed, and under what license. Remixing is redistribution
 * of a changed copy, so it needs the first to be true and the license not
 * to forbid derivatives. Creative Commons spells the latter as "ND"; the
 * rest of the world spells it in prose we cannot read, so anything we do
 * not recognize as permissive is treated as "ask the author", and the
 * Designer says so rather than guessing.
 */
import { REMIXABLE_LICENSES, type LicenseId } from "@runlog/rules-schema";

export interface LicenseLike {
  id?: unknown;
  redistributable?: unknown;
  holder?: unknown;
  notice?: unknown;
}

export type Remixability =
  | { ok: true; attribution: boolean; shareAlike: boolean }
  | { ok: false; reason: string };

export function remixable(license: LicenseLike | undefined): Remixability {
  if (!license || typeof license !== "object") return { ok: false, reason: "it carries no license" };
  const id = String(license.id ?? "").trim();
  if (license.redistributable !== true) return { ok: false, reason: "its license does not allow its text to be shared" };
  const upper = id.toUpperCase();
  if (upper.includes("-ND")) return { ok: false, reason: `${id} allows copies but not changed ones` };
  if (!REMIXABLE_LICENSES.has(id as LicenseId)) {
    return { ok: false, reason: `${id || "its license"} is not one the Designer knows to allow remixing; ask the author` };
  }
  return { ok: true, attribution: !upper.startsWith("CC0") && !upper.startsWith("UNLICENSE"), shareAlike: upper.includes("-SA") };
}

/**
 * The document, made into a new pack of your own.
 *
 * A new id, a first version, no author yet, no signature (it signed the
 * other pack) and no issue stamp (it named the other pack's buyer). The
 * original stays named in the license notice, which is the attribution
 * most permissive licenses ask for, and the license itself stays as it
 * was: a share-alike license does not stop being share-alike because you
 * changed the tables.
 */
export function remixOf(document: Record<string, unknown>): Record<string, unknown> {
  const { signature: _signature, issue: _issue, author: _author, ...rest } = document;
  const id = String(document["id"] ?? "pack");
  const title = String(document["title"] ?? id);
  const author = typeof document["author"] === "string" ? document["author"] : undefined;
  const version = String(document["version"] ?? "");
  const license = (typeof document["license"] === "object" && document["license"] !== null ? { ...(document["license"] as Record<string, unknown>) } : {}) as Record<string, unknown>;
  const basedOn = `Based on “${title}”${author ? ` by ${author}` : ""} (${id}${version ? ` v${version}` : ""}).`;
  license["notice"] = typeof license["notice"] === "string" && license["notice"] ? `${license["notice"]} ${basedOn}` : basedOn;
  return {
    ...rest,
    id: `${id}.remix`,
    title: `${title} (remix)`,
    version: "0.1.0",
    license,
  };
}
