import { configDir, deviceFlow, forgetSession, needsRenewal, readSession, renew, writeSession, type Session } from "@runlog/session";

export interface Account {
  apiBase: string;
}

/**
 * The address without its trailing slash.
 *
 * Every caller joins a path onto it, and a streamer who pastes the address
 * out of a browser bar brings the slash with them - which would ask for
 * `//api/...` and dial `//ws`. Trimmed wherever the base is used, rather
 * than trusted to have been cleaned on the way in.
 */
export function normalizeBase(apiBase: string): string {
  return apiBase.trim().replace(/\/+$/, "");
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
  renewing = null;
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
  const res = await fetch(`${normalizeBase(account.apiBase)}/api/auth/deck`);
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

/**
 * The renewal in flight, if there is one.
 *
 * WorkOS rotates the refresh token, so a second POST with the token the
 * first one just spent is refused - and the deck's two callers, the socket
 * opening and the snapshot fetch, ask for a bearer at the same moment. They
 * share the one renewal instead: whoever asks first starts it, everyone
 * else waits on it, and the file is written once.
 */
let renewing: Promise<string | null> | null = null;

/** The bearer to send, renewed first when it is about to lapse; null means sign in. */
export function bearer(_account: Account): Promise<string | null> {
  const session = loadSession();
  if (!session) return Promise.resolve(null);
  if (!needsRenewal(session, Date.now())) return Promise.resolve(session.accessToken);
  renewing ??= renew(session)
    .then((renewed) => {
      writeSession(dir(), renewed);
      return renewed.accessToken;
    })
    .catch(() => {
      // A refresh the issuer refused is a session that is over. Leave the
      // file so a retry after a network blip is not a full sign-in, and
      // let the caller read the null as "Sign in again".
      return null;
    })
    .finally(() => {
      renewing = null;
    });
  return renewing;
}
