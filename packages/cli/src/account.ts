import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import YAML from "yaml";
import { detectFormat, fingerprint, listingPayload, signBytes, verifyPack } from "@runlog/rules-schema";

/**
 * The command line, as somebody.
 *
 * `runlog login` signs in the way a terminal can: it asks WorkOS for a short
 * code, shows it with a link, and waits while you confirm it in a browser —
 * the OAuth device flow, against a WorkOS application of the CLI's own. What
 * comes back is a session: an access token that lasts an hour and a refresh
 * token that renews it, kept in the user's config directory, mode 600, and
 * renewed here without anyone noticing. Signing out forgets it.
 *
 * A machine with no browser and nobody at it — CI publishing a release — has
 * no way to confirm a code, so a key made on the profile page does instead:
 * `RUNLOG_API_KEY` in the environment, or `runlog login --key` pasted once.
 * Either way, every command that talks to the API sends what it has as the
 * bearer and the API tells the two apart.
 *
 * `claim` proves a signing key is the account's: the API hands out a nonce,
 * this signs it with the private key, and the API records the fingerprint
 * under the account — from then on the app names the account beside that
 * signature. `publish` puts a pack in the account's library, the same call
 * sync makes. `sign` and `issue` ask the API whether the key is claimed
 * before they sign, and refuse if not. Signing is arithmetic and a fork of
 * this file can always do the arithmetic; what an account buys is the right
 * to be named when the pack is opened, and the refusal is what keeps a name
 * on a signature meaning something.
 */

const DEFAULT_API = "https://runlog.scrthq.com/api";
/** Renew an access token this close to its expiry rather than risk a 401 mid-command. */
const RENEW_MARGIN_MS = 60_000;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export interface Session {
  clientId: string;
  issuer: string;
  accessToken: string;
  refreshToken: string;
  /** When the access token stops working, ISO. */
  expiresAt: string;
}

export interface Credentials {
  api: string;
  /** A key from the profile page: CI's way in, or `login --key`. */
  key?: string;
  /** A session from `runlog login`: the browser's way in, from a terminal. */
  session?: Session;
  savedAt: string;
}

function configDir(): string {
  const base =
    process.env["RUNLOG_CONFIG_DIR"] ??
    (process.platform === "win32"
      ? join(process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), "runlog")
      : join(process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "runlog"));
  return base;
}

const credentialsPath = () => join(configDir(), "credentials.json");

/** What is saved, or what the environment says: RUNLOG_API_KEY wins, for CI. */
export function credentials(): Credentials | null {
  const fromEnv = process.env["RUNLOG_API_KEY"];
  if (fromEnv) return { api: process.env["RUNLOG_API"] ?? DEFAULT_API, key: fromEnv, savedAt: "" };
  try {
    const raw = JSON.parse(readFileSync(credentialsPath(), "utf8")) as Partial<Credentials>;
    if (typeof raw.api !== "string") return null;
    if (typeof raw.key === "string") return { api: raw.api, key: raw.key, savedAt: raw.savedAt ?? "" };
    const s = raw.session;
    if (s && typeof s.accessToken === "string" && typeof s.refreshToken === "string" && typeof s.clientId === "string") {
      return {
        api: raw.api,
        session: { clientId: s.clientId, issuer: s.issuer ?? WORKOS, accessToken: s.accessToken, refreshToken: s.refreshToken, expiresAt: s.expiresAt ?? "" },
        savedAt: raw.savedAt ?? "",
      };
    }
    return null;
  } catch {
    return null;
  }
}

function save(creds: Credentials): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(credentialsPath(), `${JSON.stringify(creds, null, 2)}\n`, "utf8");
  try {
    chmodSync(credentialsPath(), 0o600);
  } catch {
    /* Windows */
  }
}

async function ask(prompt: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((done) => {
    if (hidden) {
      // Echo nothing: the key is a secret, and a terminal scrollback is a log.
      const out = process.stdout as NodeJS.WriteStream & { muted?: boolean };
      process.stdout.write(prompt);
      const original = out.write.bind(out);
      out.write = ((chunk: unknown, ...rest: unknown[]) => {
        if (typeof chunk === "string" && chunk !== "\n" && chunk !== "\r\n") return true;
        return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof out.write;
      rl.question("", (answer) => {
        out.write = original as typeof out.write;
        process.stdout.write("\n");
        rl.close();
        done(answer.trim());
      });
    } else {
      rl.question(prompt, (answer) => {
        rl.close();
        done(answer.trim());
      });
    }
  });
}

/* ---- WorkOS: the device flow and the renewal -------------------------------- */

const WORKOS = "https://api.workos.com";

/** What a token endpoint answers: tokens on success, an `error` code otherwise. */
interface TokenAnswer {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

/** The bits of the world the flow touches, so a test can hand in its own. */
export interface FlowDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  say: (line: string) => void;
  /** Try to open a URL in a browser; a failure is quiet, the code is on screen anyway. */
  open: (url: string) => void;
  now: () => number;
}

const realDeps: FlowDeps = {
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  say: (line) => console.log(line),
  open: (url) => {
    try {
      const [cmd, args] =
        process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
      spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
    } catch {
      /* no browser here; the link is printed */
    }
  },
  now: () => Date.now(),
};

async function postForm(deps: FlowDeps, url: string, form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await deps.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
  } catch {
    throw new Error(`WorkOS did not answer as expected (${response.status})`);
  }
}

/** When a JWT says it stops working, or a fallback if it does not say. */
function expiryOf(accessToken: string, now: number): string {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
    if (typeof payload.exp === "number") return new Date(payload.exp * 1000).toISOString();
  } catch {
    /* not a JWT we can read; assume WorkOS's shortest lifetime */
  }
  return new Date(now + 5 * 60_000).toISOString();
}

/**
 * The device flow, start to finish: ask for a code, show it, poll until the
 * person confirms it in a browser or the code dies. Returns the session.
 */
export async function deviceFlow(clientId: string, issuer: string, deps: FlowDeps = realDeps): Promise<Session> {
  const start = await postForm(deps, `${issuer}/user_management/authorize/device`, { client_id: clientId });
  const s = start.body as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
    error_description?: string;
  };
  if (start.status >= 400 || !s.device_code || !s.user_code || !s.verification_uri) {
    throw new Error(s.error_description ?? `WorkOS would not start a sign-in (${start.status})`);
  }
  deps.say("");
  deps.say(`  Open  ${s.verification_uri}`);
  deps.say(`  Code  ${s.user_code}`);
  deps.say("");
  deps.say("Waiting for you to confirm it there. Ctrl-C gives up.");
  if (s.verification_uri_complete) deps.open(s.verification_uri_complete);

  let interval = Math.max(1, s.interval ?? 5);
  const deadline = deps.now() + (s.expires_in ?? 300) * 1000;
  while (deps.now() < deadline) {
    await deps.sleep(interval * 1000);
    const poll = await postForm(deps, `${issuer}/user_management/authenticate`, { grant_type: DEVICE_GRANT, device_code: s.device_code, client_id: clientId });
    const a = poll.body as TokenAnswer;
    if (a.access_token && a.refresh_token) {
      return { clientId, issuer, accessToken: a.access_token, refreshToken: a.refresh_token, expiresAt: expiryOf(a.access_token, deps.now()) };
    }
    switch (a.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval += 1;
        continue;
      case "access_denied":
        throw new Error("the sign-in was refused in the browser");
      case "expired_token":
        throw new Error("the code expired before it was confirmed; run `runlog login` again");
      default:
        throw new Error(a.error_description ?? a.error ?? `WorkOS answered ${poll.status}`);
    }
  }
  throw new Error("the code expired before it was confirmed; run `runlog login` again");
}

/** A new access token from the refresh token; the refresh token rotates too. */
export async function renew(session: Session, deps: FlowDeps = realDeps): Promise<Session> {
  const answer = await postForm(deps, `${session.issuer}/user_management/authenticate`, {
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    client_id: session.clientId,
  });
  const a = answer.body as TokenAnswer;
  if (!a.access_token || !a.refresh_token) {
    throw new Error("your sign-in has lapsed; run `runlog login` again");
  }
  return { ...session, accessToken: a.access_token, refreshToken: a.refresh_token, expiresAt: expiryOf(a.access_token, deps.now()) };
}

/* ---- the API, as whoever is signed in ---------------------------------------- */

/**
 * The bearer to send: the key, or the session's access token, renewed first
 * when it is about to lapse. `force` renews regardless, after a 401.
 */
async function bearer(creds: Credentials, force = false, deps: FlowDeps = realDeps): Promise<string> {
  if (creds.key) return creds.key;
  if (!creds.session) throw new Error("not signed in: run `runlog login`");
  const lapsing = !creds.session.expiresAt || Date.parse(creds.session.expiresAt) - deps.now() < RENEW_MARGIN_MS;
  if (!force && !lapsing) return creds.session.accessToken;
  const session = await renew(creds.session, deps);
  creds.session = session;
  if (!process.env["RUNLOG_API_KEY"]) save(creds);
  return session.accessToken;
}

/** One call to the API as whoever is signed in. Throws with the API's own words on a failure. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const creds = credentials();
  if (!creds) throw new Error("not signed in: run `runlog login`");
  const once = async (token: string) => {
    const response = await fetch(`${creds.api.replace(/\/$/, "")}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`the API at ${creds.api} did not answer as expected (${response.status})`);
    }
    return { status: response.status, parsed };
  };
  let answer = await once(await bearer(creds));
  // A session's token can be refused between the expiry check and the call;
  // renew once and try again before deciding the sign-in is gone.
  if (answer.status === 401 && creds.session) answer = await once(await bearer(creds, true));
  if (answer.status === 401) {
    throw new Error(creds.key ? "that key is not accepted; make a new one on your profile page and `runlog login --key` again" : "your sign-in has lapsed; run `runlog login` again");
  }
  if (answer.status >= 400) {
    const said = (answer.parsed as { error?: string } | null)?.error;
    throw new Error(said ?? `the API said ${answer.status}`);
  }
  return answer.parsed as T;
}

/* ---- commands ---------------------------------------------------------------- */

async function greet(apiUrl: string): Promise<void> {
  const me = await api<{ profile?: { name?: string; email?: string } }>("GET", "/me");
  const who = me.profile?.name ?? me.profile?.email ?? "you";
  console.log(`signed in as ${who} at ${apiUrl}`);
}

export async function cmdLogin(args: string[], deps: FlowDeps = realDeps): Promise<number> {
  const apiUrl = (flag(args, "--api") ?? process.env["RUNLOG_API"] ?? DEFAULT_API).replace(/\/$/, "");
  if (process.env["RUNLOG_API_KEY"]) {
    console.error("RUNLOG_API_KEY is set, so that is what every command will use; unset it to sign in as yourself");
    return 1;
  }

  if (args.includes("--key")) {
    console.log("Paste a command-line key from your profile page in Runlog. It is not shown as you type.");
    const key = await ask("key: ", true);
    if (!key.startsWith("rl_")) {
      console.error("that does not look like a Runlog key; they begin with rl_");
      return 1;
    }
    // Prove it before keeping it, so a typo is caught here and not on the next command.
    save({ api: apiUrl, key, savedAt: new Date().toISOString() });
    try {
      await greet(apiUrl);
      return 0;
    } catch (error) {
      unlinkSync(credentialsPath());
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  try {
    // Which WorkOS application to sign in against is the API's to say.
    const response = await deps.fetch(`${apiUrl}/auth/cli`, { headers: { accept: "application/json" } });
    const text = await response.text();
    let about: { clientId?: string | null; issuer?: string } = {};
    try {
      about = JSON.parse(text) as typeof about;
    } catch {
      throw new Error(`the API at ${apiUrl} did not answer as expected (${response.status})`);
    }
    if (!about.clientId) throw new Error(`the API at ${apiUrl} cannot sign in a terminal yet; use \`runlog login --key\` with a key from your profile page`);
    const session = await deviceFlow(about.clientId, about.issuer ?? WORKOS, deps);
    save({ api: apiUrl, session, savedAt: new Date().toISOString() });
    await greet(apiUrl);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function cmdLogout(): number {
  const creds = credentials();
  if (existsSync(credentialsPath())) {
    unlinkSync(credentialsPath());
    console.log(creds?.key ? "signed out; the key is still valid until you revoke it on your profile page" : "signed out");
  } else {
    console.log("not signed in");
  }
  return 0;
}

export async function cmdWhoami(): Promise<number> {
  try {
    const creds = credentials();
    const me = await api<{ sub: string; scope?: string; profile?: { name?: string; email?: string } }>("GET", "/me");
    const claims = await api<{ claims: Array<{ fingerprint: string }> }>("GET", "/claims");
    const how = process.env["RUNLOG_API_KEY"] ? "with RUNLOG_API_KEY" : creds?.key ? "with a key from the profile page" : "from the browser";
    console.log(`${me.profile?.name ?? "(no name)"} <${me.profile?.email ?? "?"}>  ${me.sub}`);
    console.log(`signed in ${how} at ${creds?.api ?? DEFAULT_API}${me.scope === "release" ? " (a key that only releases)" : ""}`);
    console.log(claims.claims.length > 0 ? `claimed signing keys: ${claims.claims.map((c) => c.fingerprint).join(", ")}` : "no claimed signing keys yet: `runlog claim key.json`");
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

interface StoredKey {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

function readKey(path: string): StoredKey {
  const key = JSON.parse(readFileSync(resolve(path), "utf8")) as Partial<StoredKey>;
  if (!key.privateKey || !key.publicKey) throw new Error(`${path} is not a runlog signing key`);
  return { publicKey: key.publicKey, privateKey: key.privateKey, fingerprint: key.fingerprint ?? "" };
}

export async function cmdClaim(args: string[]): Promise<number> {
  const keyPath = args.filter((a) => !a.startsWith("-"))[0];
  if (!keyPath) {
    console.error("usage: runlog claim key.json");
    return 2;
  }
  try {
    const key = readKey(keyPath);
    const { nonce } = await api<{ nonce: string }>("POST", "/claims/nonce");
    const signature = await signBytes(new TextEncoder().encode(nonce), key.privateKey);
    const { claim } = await api<{ claim: { fingerprint: string; name: string | null } }>("POST", "/claims", { publicKey: key.publicKey, nonce, signature });
    console.log(`claimed ${claim.fingerprint}${claim.name ? ` as ${claim.name}` : ""}`);
    console.log("packs signed with this key now show your name in the app");
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * Is this key claimed by the signed-in account? `sign` and `issue` refuse
 * otherwise, with the command that fixes it.
 */
export async function requireClaimed(publicKey: string): Promise<void> {
  const fp = await fingerprint(publicKey);
  const { claims } = await api<{ claims: Array<{ fingerprint: string }> }>("GET", "/claims");
  if (!claims.some((c) => c.fingerprint === fp)) {
    throw new Error(`this key (${fp}) is not claimed by your account: run \`runlog claim key.json\` first, so the app can name you`);
  }
}

export async function cmdPublish(args: string[]): Promise<number> {
  const input = args.filter((a) => !a.startsWith("-"))[0];
  if (!input) {
    console.error("usage: runlog publish <pack.yaml|pack.json>");
    return 2;
  }
  try {
    const path = resolve(input);
    const text = readFileSync(path, "utf8");
    const format = detectFormat(path);
    const doc = (format === "json" ? JSON.parse(text) : YAML.parse(text)) as Record<string, unknown>;
    const id = String(doc["id"] ?? "");
    if (!id) throw new Error("the pack has no id");
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
    const at = new Date().toISOString();
    await api("PUT", `/packs/${encodeURIComponent(id)}`, {
      title: String(doc["title"] ?? id),
      version: String(doc["version"] ?? ""),
      format,
      filename: input.split(/[\\/]/).pop(),
      importedAt: at,
      updatedAt: at,
      hash,
      source: text,
    });
    console.log(`published ${id} to your library; it reaches your devices on their next sync`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

/**
 * The price a release is listed at: `--price 3.00` in dollars, `--free`, or
 * neither, which keeps whatever the catalog has. The API takes whole cents.
 */
export function priceFlag(args: string[]): { amount: number; currency: "usd" } | "free" | "keep" | { error: string } {
  if (args.includes("--free")) return "free";
  const raw = flag(args, "--price");
  if (raw === undefined) return "keep";
  const m = /^\$?(\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!m) return { error: `--price wants dollars and cents, like 3.00; got ${JSON.stringify(raw)}` };
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  if (cents < 100 || cents > 100_000) return { error: "--price is from 1.00 to 1000.00" };
  return { amount: cents, currency: "usd" };
}

/**
 * A release to the catalog: the signed pack goes up as the publisher's
 * master and is listed, at a price, free, or as it already is. This is what
 * a build server runs when a tag is pushed, with RUNLOG_API_KEY set; the
 * catalog seals what you signed and never sees your signing key.
 */
export async function cmdRelease(args: string[]): Promise<number> {
  const input = args.filter((a) => !a.startsWith("-"))[0];
  const price = priceFlag(args);
  if (!input || (typeof price === "object" && "error" in price)) {
    if (typeof price === "object" && "error" in price) console.error(price.error);
    console.error("usage: runlog release <pack.yaml|pack.json> [--price 3.00 | --free] [--draft]");
    return 2;
  }
  try {
    const path = resolve(input);
    const text = readFileSync(path, "utf8");
    const format = detectFormat(path);
    const raw = (format === "json" ? JSON.parse(text) : YAML.parse(text)) as Record<string, unknown>;
    const verified = await verifyPack(raw);
    if (verified.status === "unsigned") throw new Error("the pack is not signed; run `runlog sign` first, since the catalog seals what you signed");
    if (verified.status === "invalid") throw new Error(`the signature does not match the pack (${verified.reason}); sign it again`);
    const listing = listingPayload(text, format, raw);
    if (!listing.ok) throw new Error(listing.error);
    const { pack, payload } = listing;

    const me = await api<{ publisher: { name: string } | null }>("GET", "/publishers/me");
    if (!me.publisher) throw new Error("this account is not a publisher; become one on your profile page first");

    const id = encodeURIComponent(pack.id);
    const put = await api<{ pack: { status: string; price: { amount: number; currency: string } | null } }>("PUT", `/publishers/packs/${id}`, payload);
    const dollars = (p: { amount: number; currency: string }) => `${p.currency.toUpperCase()} ${(p.amount / 100).toFixed(2)}`;
    console.log(`uploaded ${pack.id} v${pack.version} to ${me.publisher.name}`);

    if (args.includes("--draft")) {
      console.log(put.pack.status === "listed" ? "  still listed; the card follows the new version" : "  kept as a draft; list it with --price or --free");
      return 0;
    }
    if (price === "keep") {
      if (put.pack.status === "listed") console.log(`  listed ${put.pack.price ? `at ${dollars(put.pack.price)}` : "free"}, as before`);
      else console.log("  not listed yet; pass --price 3.00 or --free to put it in the catalog");
      return 0;
    }
    const listed = await api<{ available?: boolean; error?: string; listing?: { price: "free" | { amount: number; currency: string } } }>("POST", `/publishers/packs/${id}/listing`, price === "free" ? {} : price);
    if (listed.available === false) throw new Error(listed.error ?? "selling is not switched on here yet; a free listing works");
    const shown = listed.listing?.price;
    console.log(`  listed ${shown && shown !== "free" ? `at ${dollars(shown)}` : "free"}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
