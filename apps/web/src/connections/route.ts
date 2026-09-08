/**
 * A link from somewhere else of the person's: `#link/discord?c=<code>`,
 * the address the Runlog bot shows after `/link` in Discord, and
 * `#link/guild?c=<code>`, the one it shows after `/setup claim`. The code
 * is the whole message; it names nobody until it is handed in signed in,
 * which is how the two accounts, or the server and the account, meet.
 */
export type LinkKind = "discord" | "guild";

export interface LinkRoute {
  kind: LinkKind;
  code: string;
}

export function linkFromHash(hash: string): LinkRoute | null {
  const m = /^#link\/(discord|guild)\?(.*)$/.exec(hash);
  if (!m) return null;
  const code = (new URLSearchParams(m[2]).get("c") ?? "").trim();
  return code ? { kind: m[1] as LinkKind, code } : null;
}

const KEY = "runlog:link";

/**
 * Kept until it has been acted on, because acting on it usually means
 * signing in first, and sign-in is a round trip through WorkOS that comes
 * back to a fresh page. Session storage: this tab, and gone with it.
 */
export function stashLink(route: LinkRoute): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(route));
  } catch {
    /* a browser with no storage keeps it for the page */
  }
}

/** The link waiting, of the kind asked for; any kind when none is named. */
export function pendingLink(kind?: LinkKind): LinkRoute | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { kind?: unknown; code?: unknown };
    if ((parsed.kind !== "discord" && parsed.kind !== "guild") || typeof parsed.code !== "string" || !parsed.code) return null;
    if (kind && parsed.kind !== kind) return null;
    return { kind: parsed.kind, code: parsed.code };
  } catch {
    return null;
  }
}

export function clearPendingLink(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
