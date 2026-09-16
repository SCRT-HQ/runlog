import type { Pack } from "@runlog/rules-schema";
// The `/load` entry rather than the package's own, which re-exports the
// signing and the container with it: none of that is read here, and all of
// it would go into the plugin's one bundled file.
import { loadPackText, type PackFormat } from "@runlog/rules-schema/load";

import { bearer, normalizeBase } from "./session.ts";

/**
 * The account's own library, read straight off the API.
 *
 * The plugin follows runs, not packs, so nothing else here asks the server
 * about a pack. A key that builds a profile for a pack the deck is not on
 * has to: it needs the list to offer, and the pack file to lay out. Both
 * are the sync routes the browser uses, on the deck's own bearer, which is
 * how `socket.ts` fetches a snapshot.
 */

/** A pack the account holds, as much of it as a picker needs. */
export interface LibraryPack {
  id: string;
  title: string;
}

/** A GET on the signed-in API, or `null` for anything that did not come back as JSON. */
async function get<T>(base: string, path: string): Promise<T | null> {
  const token = await bearer({ apiBase: base });
  if (!token) return null;
  try {
    const res = await fetch(`${normalizeBase(base)}${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Every pack the account has synced, by title.
 *
 * A pack it deleted is a tombstone in the manifest rather than a row that
 * is gone, so those are dropped; so is one with no title, which is a row
 * from a server older than this and nothing a picker could name.
 */
export async function libraryPacks(base: string): Promise<LibraryPack[]> {
  const body = await get<{ packs?: Array<{ id?: string; title?: string; deletedAt?: string }> }>(base, "/api/sync/manifest");
  return (body?.packs ?? [])
    .filter((p): p is { id: string; title: string } => typeof p.id === "string" && typeof p.title === "string" && !p.deletedAt)
    .map(({ id, title }) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * One pack off the account, parsed.
 *
 * `null` for a pack the account has not synced, which is a pack that lives
 * only in the browser that imported it: the route answers `found: false`
 * and there is no file to lay anything out from. Also for a pack whose
 * source will not parse, which the app would refuse to run either.
 */
export async function fetchPack(base: string, id: string): Promise<Pack | null> {
  const body = await get<{ found?: boolean; pack?: { source?: string; format?: PackFormat } }>(
    base,
    `/api/packs/${encodeURIComponent(id)}`,
  );
  const source = body?.found === true ? body.pack?.source : undefined;
  if (!source) return null;
  const parsed = loadPackText(source, body?.pack?.format ?? "yaml");
  return parsed.ok ? parsed.pack : null;
}
