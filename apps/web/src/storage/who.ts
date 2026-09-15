/**
 * Whose data this is.
 *
 * Everything this app keeps on the device lived in one database with one
 * name. That is right for a copy on disk, where there are no accounts at
 * all, and wrong the moment a browser has been signed in to something:
 * signing out cleared nothing, so the next person to open the app, or
 * the same person on a phone that had never signed in, saw whatever the
 * last account had synced down, packs included.
 *
 * So the database is named for whoever is looking at it, and signed out
 * is somebody: `anon` is a person with their own shelf, not a view of
 * the last person's.
 *
 * ## What this deliberately does not do
 *
 * It does not put the site in the name. IndexedDB is scoped to an origin
 * by the browser (scheme, host and port), so `runlog.example.com` and
 * `runlog.dev.example.com` already cannot see each other's databases, and
 * neither can http and https on the same host. Putting the host in the
 * name would add a part that can never vary, and imply a protection that
 * comes from somewhere else.
 *
 * ## What it uses for a name
 *
 * The account's id, not its email. An email is a thing people change,
 * and changing it would strand somebody from their own runs; it is also
 * the one piece of personal data here that would otherwise sit in a
 * database name, readable by anything that can list databases.
 */

/** Who the device is keeping data for. */
export type Who = { kind: "local" } | { kind: "anon" } | { kind: "account"; id: string };

/**
 * A build with nothing to sign in to keeps the name it always had.
 *
 * Not a migration so much as the absence of one: a copy on disk, a static
 * page and the tests have no accounts, so they have no leak to fix and no
 * reason to move their data.
 */
export const LEGACY_NAME = "runlog";

export function nameFor(who: Who): string {
  if (who.kind === "local") return LEGACY_NAME;
  if (who.kind === "anon") return `${LEGACY_NAME}:anon`;
  // Prefixed, so an account can never collide with `anon` whatever an id
  // turns out to look like.
  return `${LEGACY_NAME}:u:${who.id}`;
}

let settled: Who | null = null;
let waiting: Array<(who: Who) => void> = [];
const listeners = new Set<(who: Who) => void>();

/**
 * How long to wait for the account to report before assuming nobody.
 *
 * The account is asked over the network and may take a moment, or never
 * answer. Whichever way it fails, the safe answer is the one that can see
 * least: somebody who is not signed in cannot open a signed-in shelf, and
 * the worst that happens is an empty library until the answer arrives.
 */
const PATIENCE_MS = 5000;

/** Called by the app once it knows, and again whenever it changes. */
export function whoIsHere(who: Who): void {
  const before = settled;
  settled = who;
  for (const resolve of waiting) resolve(who);
  waiting = [];
  if (before && nameFor(before) !== nameFor(who)) {
    for (const listener of listeners) listener(who);
  }
}

/** Told when the answer changes, so an open database can be closed. */
export function onWhoChanged(listener: (who: Who) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whose data to open, once that is known. */
export function whoAmI(): Promise<Who> {
  if (settled) return Promise.resolve(settled);
  return new Promise<Who>((resolve) => {
    waiting.push(resolve);
    setTimeout(() => resolve(settled ?? { kind: "anon" }), PATIENCE_MS);
  });
}

/** What has been settled, for anything that must not wait. Null until it is. */
export function whoSoFar(): Who | null {
  return settled;
}

/** For tests, which need each one to start from nothing. */
export function forgetWho(): void {
  settled = null;
  waiting = [];
  listeners.clear();
}
