import { featuresOf } from "./features.ts";
import { generateDoc, type Doc } from "./docs.ts";
import { loadPackText, type PackFormat } from "./load.ts";
import type { Pack } from "./pack.ts";

/**
 * What the marketplace is told about a pack when it is uploaded: the head a card
 * is drawn from and the summary a listing page shows, computed from the
 * source exactly as the app would. The command line, the deploy that seeds
 * the built-ins, and the app's own upload all go through here, so a card
 * looks the same whoever made it.
 */
/**
 * What kind of thing a listing is.
 *
 * The marketplace sold one kind of thing and so never had to say which.
 * A setup is a document of its own, written for a tool rather than for a
 * pack, and somebody looking for one is not looking for the other.
 *
 * The same word the documents use: a setup declares `kind: setup` and a
 * pack declares nothing, so absence means pack here exactly as it does
 * there, and every listing already written stays a pack without being
 * touched.
 */
export type ListingKind = "pack" | "setup";

export interface ListingHead {
  /** Absent on every listing written before there was more than one kind. */
  kind?: ListingKind;
  title: string;
  version: string;
  author?: string;
  description?: string;
  category: string;
  tags: string[];
  features: string[];
  requires: Array<{ label: string; kind: string; optional?: boolean }>;
  players: number;
  license: { id: string; redistributable: boolean };
}

export interface ListingPayload {
  source: string;
  head: ListingHead;
  summary: Doc;
}

export type ListingResult = { ok: true; pack: Pack; payload: ListingPayload } | { ok: false; error: string };

export function listingPayload(source: string, format: PackFormat, raw: Record<string, unknown>): ListingResult {
  const loaded = loadPackText(source, format);
  if (!loaded.ok) {
    const errors = loaded.diagnostics.filter((d) => d.level === "error").map((d) => `${d.path ? `${d.path}: ` : ""}${d.message}`);
    return { ok: false, error: errors.join("; ") || "the pack does not load" };
  }
  const pack = loaded.pack;
  const { features, players } = featuresOf(raw);
  const head: ListingHead = {
    title: pack.title,
    version: pack.version,
    ...(pack.author ? { author: pack.author } : {}),
    ...(pack.description ? { description: pack.description } : {}),
    category: pack.category ?? "other",
    tags: pack.tags ?? [],
    features,
    requires: (pack.requires ?? []).map((r) => ({ label: r.label, kind: r.kind, ...(r.optional ? { optional: true } : {}) })),
    players,
    license: { id: pack.license.id, redistributable: pack.license.redistributable },
  };
  return { ok: true, pack, payload: { source, head, summary: generateDoc(pack, "summary") } };
}
