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

/**
 * A GET on the signed-in API, with the status it came back on.
 *
 * The status is kept because a pack route answers 410 for one the account
 * deleted and 200 for one it never had, and a caller that only saw `null`
 * would tell the streamer the same wrong thing about both. Status 0 is
 * nobody signed in, or nothing that answered at all.
 */
async function get<T>(base: string, path: string): Promise<{ status: number; body: T | null }> {
  const token = await bearer({ apiBase: base });
  if (!token) return { status: 0, body: null };
  try {
    const res = await fetch(`${normalizeBase(base)}${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return { status: res.status, body: null };
    return { status: res.status, body: (await res.json()) as T };
  } catch {
    return { status: 0, body: null };
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
  const { body } = await get<{ packs?: Array<{ id?: string; title?: string; deletedAt?: string }> }>(base, "/api/sync/manifest");
  return (body?.packs ?? [])
    .filter((p): p is { id: string; title: string } => typeof p.id === "string" && typeof p.title === "string" && !p.deletedAt)
    .map(({ id, title }) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Why a pack did not come back, in the words the log should carry.
 *
 * Four things look the same from a key that only knows it got nothing, and
 * only one of them is fixed by building the profile from the pack's library
 * card instead. Telling a streamer to go there when the source is malformed
 * or the server is down sends them somewhere that cannot help.
 */
export type NoPack = "unsynced" | "deleted" | "unreadable" | "unreachable";

/** What each of them reads as in the log, after the pack's id. */
const SAY: Record<NoPack, string> = {
  unsynced: "is not synced to this account, so there is no pack file to lay out",
  deleted: "was deleted from this account",
  unreadable: "has a source that will not parse",
  unreachable: "could not be read from the account",
};

/** One pack off the account, parsed, or why it did not come back. */
export type FetchedPack = { ok: true; pack: Pack } | { ok: false; why: NoPack; say: string };

const no = (why: NoPack): FetchedPack => ({ ok: false, why, say: SAY[why] });

/**
 * One pack off the account.
 *
 * `unsynced` is a pack that lives only in the browser that imported it: the
 * route answers `found: true` for everything the account holds, so a plain
 * 200 that found nothing means the account never had it. `deleted` is the
 * route's own 410, which is a tombstone rather than an absence. Anything
 * else that did not answer, refused, or answered something unparseable is
 * `unreachable`, and a source the loader turns down is `unreadable`.
 */
export async function fetchPack(base: string, id: string): Promise<FetchedPack> {
  const { status, body } = await get<{ found?: boolean; pack?: { source?: string; format?: PackFormat } }>(
    base,
    `/api/packs/${encodeURIComponent(id)}`,
  );
  if (status === 410) return no("deleted");
  if (status !== 200 || !body) return no("unreachable");
  if (body.found !== true) return no("unsynced");
  const source = body.pack?.source;
  // Found, with nothing in it: a row the account holds whose file never
  // landed. Not the streamer's library card to go to, so not `unsynced`.
  if (!source) return no("unreachable");
  const parsed = loadPackText(source, body.pack?.format ?? "yaml");
  return parsed.ok ? { ok: true, pack: parsed.pack } : no("unreadable");
}
