import { bearer as realBearer, normalizeBase, type Account } from "./session.ts";
import type { OpenRun } from "./state.ts";

/**
 * The account's open runs, asked for rather than waited for.
 *
 * The socket pushes the runs a device is holding, which is the short list
 * a deck can press right now. It says nothing while it is closed, and it
 * says nothing about a run whose page is shut, so on its own it cannot
 * answer the two questions a streamer actually has before a stream: what
 * have I got open, and which one do I want this deck on.
 *
 * This is the other half, over HTTP on the signed-in route, which works
 * with the deck switched off. What comes back is every run the account
 * owns and has not ended, newest first.
 */

/** How many runs a picker is willing to show. The same twenty the socket's list is capped at. */
export const MOST_RUNS = 20;

export interface RunsDeps {
  fetch: typeof fetch;
  bearer: (a: Account) => Promise<string | null>;
}

export function realRunsDeps(): RunsDeps {
  return { fetch: (i, o) => fetch(i, o), bearer: realBearer };
}

/** One row of `/api/sessions`, of which a deck reads five fields. */
interface Pointer {
  id?: unknown;
  role?: unknown;
  packId?: unknown;
  name?: unknown;
  packTitle?: unknown;
  updatedAt?: unknown;
  endedAt?: unknown;
  deletedAt?: unknown;
}

/**
 * Every run the account has open, newest first.
 *
 * `null` rather than an empty list when the question could not be asked at
 * all: signed out, offline, a server that refused. An empty list is an
 * answer, and a picker that cleared itself every time the network hiccuped
 * would throw away a pin the streamer had just made.
 */
export async function openRuns(account: Account, deps: RunsDeps = realRunsDeps()): Promise<OpenRun[] | null> {
  const token = await deps.bearer(account);
  if (!token) return null;
  try {
    const res = await deps.fetch(`${normalizeBase(account.apiBase)}/api/sessions`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { sessions?: unknown };
    if (!Array.isArray(body.sessions)) return null;
    return (body.sessions as Pointer[])
      .filter((p) => typeof p.id === "string" && p.role === "owner" && !p.endedAt && !p.deletedAt)
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
      .slice(0, MOST_RUNS)
      .map((p) => ({
        id: p.id as string,
        ...(typeof p.packId === "string" ? { packId: p.packId } : {}),
        ...(typeof p.name === "string" ? { name: p.name } : {}),
        ...(typeof p.packTitle === "string" ? { packTitle: p.packTitle } : {}),
      }));
  } catch {
    return null;
  }
}
