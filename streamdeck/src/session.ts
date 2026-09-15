import { configDir, deviceFlow, forgetSession, needsRenewal, readSession, renew, writeSession, type Session } from "@runlog/session";

export interface Account {
  apiBase: string;
}

/**
 * The deck's session, kept in a file of the plugin's own.
 *
 * Not in Stream Deck's global settings: those are handed to the property
 * inspector, which is a web view, and a refresh token is the one thing
 * this plugin holds that must never be. The CLI keeps its session the
 * same way, in the same directory tree, under a different name.
 */
export function sessionDir(): string {
  return configDir("runlog-deck");
}

// A test's own directory, so a test run never renews the real rotating
// token and never collides with the CLI's. Unset outside of tests.
let dirOverride: string | null = null;
export function __setSessionDirForTests(dir: string | null): void {
  dirOverride = dir;
}
function dir(): string {
  return dirOverride ?? sessionDir();
}

export function loadSession(): Session | null {
  return readSession(dir());
}

export function signOut(): void {
  forgetSession(dir());
}

async function clientOf(account: Account): Promise<{ clientId: string; issuer: string }> {
  const res = await fetch(`${account.apiBase}/api/auth/deck`);
  const body = (await res.json()) as { clientId?: string | null; issuer?: string };
  if (!body.clientId) throw new Error("this copy of Runlog has no sign-in for a deck");
  return { clientId: body.clientId, issuer: body.issuer ?? "https://api.workos.com" };
}

export async function signIn(account: Account, say: (line: string) => void, open: (url: string) => void): Promise<Session> {
  const { clientId, issuer } = await clientOf(account);
  const session = await deviceFlow(clientId, issuer, {
    fetch: (input, init) => fetch(input, init),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    say,
    open,
    now: () => Date.now(),
  });
  writeSession(dir(), session);
  return session;
}

/** The bearer to send, renewed first when it is about to lapse; null means sign in. */
export async function bearer(_account: Account): Promise<string | null> {
  const session = loadSession();
  if (!session) return null;
  if (!needsRenewal(session, Date.now())) return session.accessToken;
  try {
    const renewed = await renew(session);
    writeSession(dir(), renewed);
    return renewed.accessToken;
  } catch {
    // A refresh the issuer refused is a session that is over. Leave the
    // file so a retry after a network blip is not a full sign-in, and
    // let the caller read the null as "Sign in again".
    return null;
  }
}
