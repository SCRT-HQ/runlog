/**
 * A link from somewhere else of the person's: `#link/discord?c=<code>`,
 * the address the Runlog bot shows after `/link` in Discord, and
 * `#link/guild?c=<code>`, the one it shows after `/setup claim`. The code
 * is the whole message; it names nobody until it is handed in signed in,
 * which is how the two accounts, or the server and the account, meet.
 *
 * Without a code, `#link/discord?verify=1` is Discord sending a member to
 * verify a linked account for a server's linked roles, and
 * `#link/discord?verified=1|0` is the verification coming back.
 */
export type LinkKind = "discord" | "guild" | "verify";

export type LinkRoute = { kind: "discord" | "guild"; code: string } | { kind: "verify"; result: "asked" | "done" | "failed" };

export function linkFromHash(hash: string): LinkRoute | null {
  const m = /^#link\/(discord|guild)\?(.*)$/.exec(hash);
  if (!m) return null;
  const params = new URLSearchParams(m[2]);
  const code = (params.get("c") ?? "").trim();
  if (code) return { kind: m[1] as "discord" | "guild", code };
  if (m[1] !== "discord") return null;
  if (params.get("verify") === "1") return { kind: "verify", result: "asked" };
  const verified = params.get("verified");
  return verified === "1" ? { kind: "verify", result: "done" } : verified === "0" ? { kind: "verify", result: "failed" } : null;
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
    const parsed = JSON.parse(raw) as { kind?: unknown; code?: unknown; result?: unknown };
    let found: LinkRoute | null = null;
    if ((parsed.kind === "discord" || parsed.kind === "guild") && typeof parsed.code === "string" && parsed.code) found = { kind: parsed.kind, code: parsed.code };
    if (parsed.kind === "verify" && (parsed.result === "asked" || parsed.result === "done" || parsed.result === "failed")) found = { kind: "verify", result: parsed.result };
    if (!found || (kind && found.kind !== kind)) return null;
    return found;
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
