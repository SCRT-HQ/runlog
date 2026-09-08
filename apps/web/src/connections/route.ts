/**
 * A link from another account of the person's: `#link/discord?c=<code>`,
 * the address the Runlog bot shows after `/link` in Discord. The code is
 * the whole message; it names nobody until it is handed in signed in,
 * which is how the two accounts meet. Other services would take the same
 * shape under their own name.
 */
export interface LinkRoute {
  kind: "discord";
  code: string;
}

export function linkFromHash(hash: string): LinkRoute | null {
  const m = /^#link\/(discord)\?(.*)$/.exec(hash);
  if (!m) return null;
  const code = (new URLSearchParams(m[2]).get("c") ?? "").trim();
  return code ? { kind: "discord", code } : null;
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

export function pendingLink(): LinkRoute | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { kind?: unknown; code?: unknown };
    return parsed.kind === "discord" && typeof parsed.code === "string" && parsed.code ? { kind: "discord", code: parsed.code } : null;
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
