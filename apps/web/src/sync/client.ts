import type { Entry } from "./diff.ts";

/**
 * The API, as the app sees it.
 *
 * Every call carries the account's access token. On a 401, or on a body that
 * is not JSON, which is what the edge hands back when it has rewritten an
 * error into the app shell, the token is fetched again (the SDK refreshes
 * it) and the call retried once. After that the honest answer is "sign in
 * again", and the engine says so rather than retrying forever.
 *
 * Failures are typed, never thrown as bare errors: the engine turns each
 * kind into a status the player can read.
 */

export type SyncFailure = "unauthorized" | "offline" | "conflict" | "too-large" | "error";

/** The server asked for a plan the account does not have. */
export class PlanError extends Error {
  constructor(
    readonly plan: string,
    message: string,
  ) {
    super(message);
  }
}

export class SyncError extends Error {
  constructor(
    readonly kind: SyncFailure,
    /** On a conflict, what the server holds. */
    readonly entry?: Entry,
    message: string = kind,
  ) {
    super(message);
  }
}

/** What the account's own partition says about a session: enough to list it. */
export interface SessionPointer {
  id: string;
  role: "owner" | "player" | "viewer";
  packId: string;
  packVersion: string;
  packTitle?: string;
  name?: string;
  ownerSub: string;
  updatedAt: string;
  /** How far the server's log has got. */
  seq: number;
  endedAt?: string;
  deletedAt?: string;
}

export interface SessionMember {
  sub: string;
  role: "owner" | "player" | "viewer";
  joinedAt: string;
  name?: string;
}

export interface SessionMeta {
  id: string;
  packId: string;
  packVersion: string;
  name?: string;
  ownerSub: string;
  createdAt: string;
  updatedAt: string;
  seq: number;
  endedAt?: string;
  deletedAt?: string;
  /** Open to anyone with its link. */
  shared?: boolean;
  /** Taking asks from outside, and how: waiting for the host, or taking them as they land. Null when not. */
  asks?: { policy: AskPolicy; since?: string } | null;
}

export type AskPolicy = "ask" | "auto";

/** Which of the account's two stream keys: one to watch by, one to press by. */
export type StreamKeyKind = "watch" | "press";

/** What the account holds, as the server will say: that a key exists, and since when. */
export interface StreamKeys {
  watch?: { madeAt: string };
  press?: { madeAt: string };
}

/**
 * Something from outside the table, a chat command, a channel-point redeem,
 * a button, asking the run to take a move or roll the waiting table. The
 * host's device answers; the answer stays beside the ask.
 */
export interface Ask {
  id: string;
  kind: "move" | "roll";
  move?: string;
  name?: string;
  via?: string;
  at: string;
  answer?: "accepted" | "declined";
  answeredAt?: string;
  reason?: string;
}

/** A run as its link shows it to anyone: the whole thing where the pack may travel, else the owner's snapshot. */
export interface PublicRun {
  run: { id: string; packId: string; packVersion: string; packTitle: string | null; name: string | null; seq: number; updatedAt: string; endedAt: string | null };
  access: "full" | "snapshot";
  pack?: { format: "yaml" | "json"; source: string } | null;
  events?: unknown[];
  snapshot?: { at: string; snapshot: unknown } | null;
  listing?: { id: string; price: unknown } | null;
  /** What the watchers have sent back, oldest first. */
  reactions?: Reaction[];
}

/** A reaction from a watcher: one of a few emoji, a name if they gave one, and when. */
export interface Reaction {
  emoji: string;
  name?: string;
  at: string;
}

/** What a watcher may send: the same few the server accepts. */
export const REACTIONS = ["👏", "🔥", "😮", "😂", "💀", "❤️"] as const;

/** An invitation, as the owner sees it. */
export interface Invite {
  token: string;
  email: string;
  role: "player" | "viewer";
  createdAt: string;
  expiresAt: string;
  accepted: boolean;
  acceptedAt?: string;
}

/** Somebody this account has shared a session with. */
export interface Person {
  sub: string;
  name?: string;
  email?: string;
  lastPlayedAt: string;
}

/** A race across devices: one run per racer, the same seed, progress reported. */
export interface RaceMeta {
  id: string;
  code: string;
  packId: string;
  packVersion: string;
  packTitle?: string;
  name?: string;
  mode: string;
  seed: string;
  ownerSub: string;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  seq: number;
}
export interface RaceEntry {
  sub: string;
  name?: string;
  sessionId?: string;
  joinedAt: string;
  progress?: { unit: number; unitsDone: number; status: "active" | "ended"; ending?: string; elapsedMs: number; updatedAt: string };
}
export interface Race {
  meta: RaceMeta;
  entries: RaceEntry[];
}

/** A command-line key, as the profile lists it: never the secret. */
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
  /** What the key may do: everything, or only check, sign, publish and release packs. Missing means full. */
  scope?: KeyScope;
}

export type KeyScope = "full" | "release";

/** A signing key this account has proved it holds. */
export interface Claim {
  fingerprint: string;
  publicKey: string;
  name: string | null;
  claimedAt: string;
  /** The claimant's publisher, where they have one. */
  publisher?: { id: string; name: string };
}

/** A publisher's pack as uploaded: its head, its price, whether it is listed. */
export interface PublisherPack {
  packId: string;
  head: { title: string; version: string; category: string; tags: string[]; features: string[]; players: number };
  price: { amount: number; currency: string } | null;
  status: "draft" | "listed";
  bytes: number;
  updatedAt: string;
}

/** A sale, as the buyer sees it. */
export interface Purchase {
  ref: string;
  packId: string;
  title: string;
  status: "pending" | "fulfilled" | "revoked";
  amount?: number;
  currency?: string;
  createdAt?: string;
  /** The license key, once fulfilled. */
  key?: string;
}

/** A sale, as the publisher's ledger shows it. */
export interface SaleRow {
  ref: string;
  packId: string;
  title: string;
  buyerEmail: string | null;
  amount: number;
  currency: string;
  fee: number;
  status: "pending" | "fulfilled" | "revoked";
  createdAt: string;
  fulfilledAt: string | null;
  revokedAt: string | null;
  key?: string | null;
}

/** Someone in a publisher, by WorkOS's book. */
export interface PublisherMember {
  userId: string;
  role: "admin" | "member";
  owner: boolean;
  me: boolean;
  email?: string;
  name?: string;
}

/** An invitation into a publisher that nobody has accepted yet. */
export interface PublisherInvitation {
  id: string;
  email: string;
  state: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
  acceptedAt?: string;
}

/** A publisher as the API describes it to its members. */
export interface PublisherView {
  id: string;
  name: string;
  owner: boolean;
  role?: "admin" | "member";
  connectStarted: boolean;
  connectReady: boolean;
  createdAt: string;
}

/** What a join link is for, readable before signing in. */
export type InvitePeek =
  | { found: false }
  | {
      found: true;
      invite: {
        role: "player" | "viewer";
        packId: string;
        packTitle: string | null;
        session: string | null;
        inviter: string | null;
        accepted: boolean;
        /** The address it went to, masked: enough to recognize. */
        sentTo: string;
        /** Whether the signed-in account is that address; null when nobody was signed in. */
        forYou: boolean | null;
        alreadyIn: boolean;
      };
    };

/** An invitation waiting for this account, as the menu shows it. */
export interface PendingInvite {
  token: string;
  role: "player" | "viewer";
  createdAt: string;
  expiresAt: string;
  packId: string;
  packTitle: string | null;
  session: string | null;
  inviter: string | null;
  alreadyIn: boolean;
}

/** An event as the server holds it: the app's event, numbered and attributed. */
export type SessionEvent = Record<string, unknown> & { id: string; seq: number; author: string; t: string; at: string };

export interface Manifest {
  packs: Entry[];
  sessions: SessionPointer[];
  /** Absent from a server older than licenses; read as none. */
  licenses?: Entry[];
}

/** A license key, as the account keeps it. `id` is the pack it opens. */
export interface RemoteLicense extends Entry {
  key: string;
  ref?: string;
  title?: string;
}

export interface RemotePack {
  id: string;
  title: string;
  version: string;
  format: "yaml" | "json";
  filename: string;
  importedAt: string;
  updatedAt: string;
  hash: string;
  source: string;
  /** Where it came from and, for a marketplace pack, which entry at which version; carried so another device can offer the update. */
  origin?: "file" | "catalog" | "sealed" | "listing";
  catalog?: { id: string; version: string };
  /** The license's word on whether the text may be handed to others; a run shared by link shows the pack only when true. */
  shareable?: boolean;
}

/** What the server knows about the person, apart from what they keep. */
export interface Profile {
  createdAt: string;
  lastSeenAt: string;
  /** The name WorkOS holds, as the app last sent it. */
  name?: string;
  /** The name this person chose to be shown as to everyone else; wins over `name`. */
  handle?: string;
  /** When they last chose it, blank or not. Absent, they have not been asked, and the app asks before showing anything. */
  handleSetAt?: string;
  email?: string;
  /** The session this account touched last, from whichever device; what a device with nothing open starts from. */
  currentSessionId?: string;
  /** The version of the hosted terms this account accepted, and when. */
  termsVersion?: string;
  termsAcceptedAt?: string;
}

export interface Me {
  sub: string;
  sid: string;
  env: string;
  profile: Profile;
  /** Stripe feature keys; empty until billing exists. */
  entitlements: string[];
  /** Whether plans gate anything on this address. */
  gates?: boolean;
  /** Whether this copy offers the server tier at all (there is a bot), and whether the plan is on sale yet. */
  servers?: boolean;
  serversOpen?: boolean;
  /** Whether becoming a publisher, and hosted licensing, are on sale yet. */
  publishersOpen?: boolean;
}

/** Another account of the person's, linked to this one: Discord's user id and the name it showed when the link was made. */
export interface DiscordConnection {
  discordUserId: string;
  name: string;
  linkedAt: string;
}

/** A service an account can be linked to. Discord is the only one so far. */
export type ConnectionService = "discord";

/**
 * An account this Runlog account is linked to: which service, that
 * service's own id for the person, and the name it showed. An account
 * holds as many as it links, of as many kinds.
 */
export interface Connection {
  service: ConnectionService;
  accountId: string;
  name: string;
  linkedAt: string;
}

export interface Connections {
  /** Whether this copy has a bot to link with at all. */
  available: boolean;
  /** Everything this account is linked to, oldest first. */
  connections: Connection[];
  /** The first Discord link, as a copy written before an account could hold several spelled it. */
  discord: DiscordConnection | null;
  /** Whether a verification for a server's linked roles can be offered: the bot's OAuth side is set up. */
  verify?: boolean;
}

/** A Discord server this account claimed: the bot plays there on the packs in its vault. */
export interface Guild {
  guildId: string;
  /** What Discord calls it, where the bot could ask. */
  name?: string;
  /** The server's members bought the plan through Discord's own store; the server holds it without this account subscribing. */
  discord?: boolean;
  ownerSub: string;
  claimedAt: string;
  updatedAt: string;
  hostRoleId?: string;
  channelId?: string;
}

/** A pack in a server's vault, as the profile lists it: never its text. */
export interface GuildPackMeta {
  id: string;
  title: string;
  version: string;
  format: "yaml" | "json";
  hash: string;
  bytes: number;
  modes: Array<{ id: string; label: string }>;
  updatedAt: string;
  delegatedBy: string;
}

export interface Api {
  me(): Promise<Me>;
  /** The other accounts linked to this one. */
  connections(): Promise<Connections>;
  /** Hand in the code `/link` minted in Discord; the Discord account it was minted for is then this one's. */
  linkDiscord(code: string): Promise<DiscordConnection>;
  /** Let one Discord account go, or every one of them where none is named. */
  unlinkDiscord(accountId?: string): Promise<void>;
  /** Begin verifying this account for a server's linked roles: the address at Discord to send the person to. */
  discordVerifyUrl(): Promise<string>;
  /** Hand in the code `/setup claim` minted; the server is then this account's. `upgrade` says the server plan is wanted and not held. */
  claimGuild(code: string): Promise<{ guild: Guild; plan: string; upgrade: boolean }>;
  /** The servers this account claimed, whether it holds the server plan (always true where plans are open), and whether the plan is on sale. */
  myGuilds(): Promise<{ guilds: Guild[]; server: boolean; open: boolean; allowed: number }>;
  /** Give the server up: its rows and its vault go. */
  releaseGuild(guildId: string): Promise<void>;
  guildPacks(guildId: string): Promise<GuildPackMeta[]>;
  /** Put a pack in the server's vault, with the summary the bot lists it by; the text never comes back. */
  delegatePack(guildId: string, pack: { packId: string; title: string; version: string; format: "yaml" | "json"; hash: string; modes: Array<{ id: string; label: string }>; source: string }): Promise<GuildPackMeta>;
  undelegatePack(guildId: string, packId: string): Promise<void>;
  /** The name and email the SDK reported, so the server's row is never older than the last visit. */
  putProfile(snapshot: { name?: string; handle?: string; email?: string; termsVersion?: string }): Promise<Profile>;
  /** Everything of the caller's on the server, gone. */
  deleteMe(): Promise<void>;
  /** Everything the account holds as one file: a link that works for a quarter of an hour, and how big it is. */
  exportMe(): Promise<{ url: string; bytes: number; expiresAt: string }>;
  manifest(): Promise<Manifest>;
  /** Start a session with its first events. Null when the id is already taken. */
  createSession(session: { id: string; packId: string; packVersion: string; packTitle?: string; name?: string; events: unknown[] }): Promise<{ session: SessionMeta; events: SessionEvent[] } | null>;
  /** The session and every event past `after`; null when there is none the caller may see. */
  getSession(id: string, after: number): Promise<{ session: SessionMeta; members: SessionMember[]; events: SessionEvent[] } | null>;
  /** Append a move. What came back numbered is `appended`; `seq` is the log's new tail. */
  appendEvents(id: string, events: unknown[]): Promise<{ appended: SessionEvent[]; seq: number }>;
  patchSession(id: string, patch: { name?: string; ended?: true }): Promise<void>;
  /** The owner ends it for everyone; a member leaves. */
  deleteSession(id: string): Promise<void>;
  createInvite(sessionId: string, email: string, role: "player" | "viewer"): Promise<{ invite: Invite; link: string }>;
  listInvites(sessionId: string): Promise<Invite[]>;
  revokeInvite(sessionId: string, token: string): Promise<void>;
  /** Join by the link's token; the account's address rides along, for an account whose profile has none yet. */
  acceptInvite(token: string, email?: string): Promise<{ sessionId: string; alreadyIn?: boolean }>;
  /** The invitations waiting for this account's address, newest first, so nobody needs the mail. */
  myInvites(): Promise<PendingInvite[]>;
  /** Turn one down: it leaves both lists and its link goes dead. */
  declineInvite(token: string): Promise<void>;
  /** Open a run to anyone with its link (the owner; Plus where plans are on); the link comes back. */
  shareRun(sessionId: string): Promise<{ link: string }>;
  unshareRun(sessionId: string): Promise<void>;
  /** Take a seat as a watcher of a run shared by link, on this account. */
  watchPublicRun(sessionId: string, token: string): Promise<{ sessionId: string; role: "owner" | "player" | "viewer" }>;
  /** What the watchers of a run sent back, for the table's own screen. */
  reactions(sessionId: string): Promise<Reaction[]>;
  /** A reaction from someone at the table, named as they are shown. */
  react(sessionId: string, emoji: string): Promise<Reaction[]>;
  /** What the outside has asked of a run, oldest first, answered or not. */
  asks(sessionId: string): Promise<Ask[]>;
  /** The host's answer to one ask. */
  answerAsk(sessionId: string, askId: string, answer: "accepted" | "declined", reason?: string): Promise<Ask[]>;
  /** Mint the run's ask key (the host; Plus where plans are on): shown once, and the run takes asks from then on. */
  mintAskKey(sessionId: string, policy?: AskPolicy): Promise<{ key: string; policy: AskPolicy }>;
  setAskPolicy(sessionId: string, policy: AskPolicy): Promise<void>;
  /** Kill the ask key; the run takes no more asks until a new one is minted. */
  revokeAskKey(sessionId: string): Promise<void>;
  /**
   * The account's stream keys: what it has, never the keys themselves.
   * A watch key is for widgets, the numbers and the socket; a press key is
   * for asks. Both outlive any run, so a scene is wired once.
   */
  streamKeys(): Promise<StreamKeys>;
  /** Make one, shown this once. Making it again replaces what was there. */
  mintStreamKey(kind: StreamKeyKind): Promise<{ key: string; keys: StreamKeys }>;
  revokeStreamKey(kind: StreamKeyKind): Promise<StreamKeys>;
  /** What a stranger sees of a run whose pack may not travel: written by the owner's device after each move. */
  putSnapshot(sessionId: string, snapshot: unknown): Promise<void>;
  removeMember(sessionId: string, sub: string): Promise<void>;
  people(): Promise<Person[]>;
  /** A Stripe Checkout for a plan, by key; `available: false` where billing is off. */
  checkout(price: "plus-monthly" | "plus-yearly" | "hosted-monthly" | "hosted-yearly" | "server-monthly" | "server-yearly"): Promise<{ url: string } | { available: false }>;
  portal(): Promise<{ url: string } | { available: false }>;
  /** Ask Stripe again what this account has, and keep the answer. */
  refreshEntitlements(): Promise<string[]>;
  myPublisher(): Promise<PublisherView | null>;
  becomePublisher(name: string): Promise<PublisherView>;
  /** What the marketplace calls this publisher, and how many of its listings were re-stamped with it. */
  renamePublisher(name: string): Promise<{ publisher: PublisherView; listings: number }>;
  /** Stripe's hosted onboarding for payouts; `available: false` where billing is off. */
  connectPublisher(): Promise<{ url: string } | { available: false }>;
  refreshPublisherConnect(): Promise<PublisherView | null>;
  publisherDashboard(): Promise<{ url: string } | { available: false }>;
  /** The people in the publisher and the invitations out; `available: false` where WorkOS is not wired. */
  publisherMembers(): Promise<{ members: PublisherMember[]; invitations: PublisherInvitation[]; available?: false }>;
  invitePublisherMember(email: string, role: "admin" | "member"): Promise<PublisherInvitation | { available: false }>;
  revokePublisherInvitation(id: string): Promise<void>;
  removePublisherMember(userId: string): Promise<void>;
  /** Invite someone to Runlog itself; WorkOS sends the mail. */
  inviteFriend(email: string): Promise<{ sent: true; email: string } | { available: false }>;
  /** The invitations this account sent to the platform, newest first, in every state. */
  myInvitations(): Promise<PublisherInvitation[]>;
  revokeFriendInvitation(id: string): Promise<void>;
  /** Buy a priced listing: a Checkout to go to, and the sale's reference. */
  startPurchase(packId: string): Promise<{ url: string; ref: string } | { available: false } | { found: false } | { owned: true }>;
  purchase(ref: string): Promise<Purchase | null>;
  /** The buyer's sealed copy, as bytes. */
  purchaseFile(ref: string): Promise<Uint8Array>;
  myPurchases(): Promise<Purchase[]>;
  sales(): Promise<SaleRow[]>;
  reissueSale(ref: string): Promise<SaleRow>;
  revokeSale(ref: string): Promise<SaleRow>;
  publisherPacks(): Promise<PublisherPack[]>;
  /** Upload a pack's signed master with the head and summary the app computed. */
  putPublisherPack(packId: string, body: { source: string; head: Record<string, unknown>; summary: unknown }): Promise<PublisherPack>;
  /** List it: free with no price, else in cents. `available: false` where selling is off. */
  listPublisherPack(packId: string, price?: { amount: number; currency: string }): Promise<PublisherPack | { available: false }>;
  unlistPublisherPack(packId: string): Promise<PublisherPack | null>;
  deletePublisherPack(packId: string): Promise<void>;
  /** Start a race: this run is the first entry. */
  createRace(race: { id: string; packId: string; packVersion: string; packTitle?: string; name?: string; mode: string; seed: string; sessionId: string }): Promise<Race>;
  myRaces(): Promise<Race[]>;
  /** Join by code; throws with the API's words when no race answers to it. */
  joinRace(code: string): Promise<Race>;
  getRace(id: string): Promise<Race | null>;
  putRaceEntry(id: string, patch: { sessionId?: string; name?: string; progress?: Omit<NonNullable<RaceEntry["progress"]>, "updatedAt"> }): Promise<Race | null>;
  patchRace(id: string, patch: { name?: string; ended?: true }): Promise<Race | null>;
  inviteToRace(id: string, email: string): Promise<{ link: string; code: string }>;
  listKeys(): Promise<ApiKey[]>;
  /** The secret comes back exactly once. */
  createKey(name: string, scope?: KeyScope): Promise<{ key: ApiKey; secret: string }>;
  revokeKey(id: string): Promise<void>;
  listClaims(): Promise<Claim[]>;
  removeClaim(fingerprint: string): Promise<void>;
  claimNonce(): Promise<{ nonce: string }>;
  claim(publicKey: string, nonce: string, signature: string): Promise<Claim>;
  getPack(id: string): Promise<RemotePack | null>;
  putPack(pack: RemotePack, ifMatch?: string): Promise<Entry>;
  deletePack(id: string): Promise<void>;
  getLicense(packId: string): Promise<RemoteLicense | null>;
  putLicense(license: RemoteLicense, ifMatch?: string): Promise<Entry>;
  deleteLicense(packId: string): Promise<void>;
}

type Fetch = typeof fetch;

/** A sealed copy as bytes, by a bearer or by the token in a receipt; an error says what the server said. */
export async function fetchBytes(url: string, token?: string, fetchImpl: Fetch = fetch): Promise<Uint8Array> {
  const response = await fetchImpl(url, { cache: "no-store", ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || type.includes("json") || type.includes("html")) {
    let said = "";
    try {
      said = ((await response.json()) as { error?: string }).error ?? "";
    } catch {
      /* not JSON */
    }
    throw new Error(said || (response.status === 410 ? "this copy was revoked" : "the copy could not be fetched"));
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** The buyer's sealed copy by the token in the receipt mail: no account needed. */
/** A run by its live link, no account: null when the link is not open. */
/** A reaction to a run watched by its link; no account. What comes back is the run's recent reactions. */
export async function reactToRun(base: string, id: string, token: string, emoji: string, name?: string, fetchImpl: Fetch = fetch): Promise<Reaction[]> {
  const response = await fetchImpl(`${base.replace(/\/$/, "")}/public/runs/${encodeURIComponent(id)}/reactions?t=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ emoji, ...(name ? { name } : {}) }),
  });
  const body = (await response.json()) as { reactions?: Reaction[]; error?: string };
  if (response.status !== 200 || !body.reactions) throw new SyncError("error", undefined, body.error ?? "that did not land");
  return body.reactions;
}

export async function publicRun(base: string, id: string, token: string, fetchImpl: Fetch = fetch): Promise<PublicRun | null> {
  const response = await fetchImpl(`${base.replace(/\/$/, "")}/public/runs/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`, { cache: "no-store" });
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) throw new SyncError("error", undefined, "no answer");
  const body = (await response.json()) as PublicRun & { found?: boolean };
  if (response.status === 410 || body.found === false) return null;
  return body;
}

/** The socket's address for a live link: the run and its token in the query, no account. */
export function publicSocketUrl(apiBase: string, id: string, token: string): string {
  const url = new URL(apiBase.replace(/\/api\/?$/, "/ws"));
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.searchParams.set("run", id);
  url.searchParams.set("t", token);
  return url.href;
}

export function purchaseFileByToken(base: string, ref: string, token: string, fetchImpl: Fetch = fetch): Promise<Uint8Array> {
  return fetchBytes(`${base.replace(/\/$/, "")}/purchases/${encodeURIComponent(ref)}/file?t=${encodeURIComponent(token)}`, undefined, fetchImpl);
}

/** Who claimed a signing key. No account: the badge asks for any signature it sees. */
export async function authorOf(base: string, fingerprint: string, fetchImpl: Fetch = fetch): Promise<Claim | null> {
  const response = await fetchImpl(`${base.replace(/\/$/, "")}/authors/${encodeURIComponent(fingerprint)}`, { cache: "no-store" });
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) return null;
  const body = (await response.json()) as { found: boolean; claim?: Claim };
  return body.found && body.claim ? body.claim : null;
}

/**
 * What a join link is for. Works without an account, so the banner can ask
 * before the sign-in it will lead to; given one, the answer also says
 * whether the link is this account's.
 */
export async function peekInvite(base: string, token: string, accessToken?: string, fetchImpl: Fetch = fetch): Promise<InvitePeek> {
  const response = await fetchImpl(`${base.replace(/\/$/, "")}/invites/${encodeURIComponent(token)}`, {
    cache: "no-store",
    ...(accessToken ? { headers: { authorization: `Bearer ${accessToken}` } } : {}),
  });
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) throw new SyncError("error", undefined, "no answer");
  return (await response.json()) as InvitePeek;
}

export function createApi(
  base: string,
  getAccessToken: () => Promise<string>,
  fetchImpl: Fetch = fetch,
): Api {
  const root = base.replace(/\/$/, "");

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    retried = false,
  ): Promise<{ status: number; body: T }> {
    let token: string;
    try {
      token = await getAccessToken();
    } catch {
      throw new SyncError("unauthorized");
    }
    let response: Response;
    try {
      response = await fetchImpl(root + path, {
        method,
        cache: "no-store",
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new SyncError("offline");
    }

    const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
    if (response.status === 401 || !isJson) {
      if (!retried) return request<T>(method, path, body, headers, true);
      throw new SyncError("unauthorized");
    }
    const parsed = (await response.json()) as T;
    if (response.status === 409) throw new SyncError("conflict", (parsed as { entry?: Entry }).entry);
    if (response.status === 413) throw new SyncError("too-large");
    if (response.status >= 500) throw new SyncError("error", undefined, `server said ${response.status}`);
    return { status: response.status, body: parsed };
  }

  return {
    me: async () => (await request<Me>("GET", "/me")).body,
    putProfile: async (snapshot) => (await request<{ profile: Profile }>("PUT", "/me/profile", snapshot)).body.profile,
    deleteMe: async () => {
      await request("DELETE", "/me");
    },
    exportMe: async () => {
      const { status, body } = await request<{ url?: string; bytes?: number; expiresAt?: string; error?: string }>("POST", "/me/export");
      if (status !== 200 || !body.url) throw new SyncError("error", undefined, body.error ?? "the export could not be made");
      return { url: body.url, bytes: body.bytes ?? 0, expiresAt: body.expiresAt ?? "" };
    },
    manifest: async () => (await request<Manifest>("GET", "/sync/manifest")).body,

    createSession: async (session) => {
      try {
        return (await request<{ session: SessionMeta; events: SessionEvent[] }>("POST", "/sessions", session)).body;
      } catch (error) {
        if (error instanceof SyncError && error.kind === "conflict") return null;
        throw error;
      }
    },
    getSession: async (id, after) => {
      const { status, body } = await request<{ found: boolean; session?: SessionMeta; members?: SessionMember[]; events?: SessionEvent[] }>(
        "GET",
        `/sessions/${id}${after > 0 ? `?after=${after}` : ""}`,
      );
      return status === 200 && body.found && body.session
        ? { session: body.session, members: body.members ?? [], events: body.events ?? [] }
        : null;
    },
    appendEvents: async (id, events) => {
      // A session the server does not know answers `found: false` with a 200 and nothing appended.
      const { body } = await request<{ found?: boolean; appended?: SessionEvent[]; seq?: number }>("POST", `/sessions/${id}/events`, { events });
      if (body.found === false) throw new SyncError("error", undefined, "the server does not know this run");
      return { appended: body.appended ?? [], seq: body.seq ?? 0 };
    },
    patchSession: async (id, patch) => {
      await request("PATCH", `/sessions/${id}`, patch);
    },
    deleteSession: async (id) => {
      await request("DELETE", `/sessions/${id}`);
    },

    checkout: async (price) => {
      const { status, body } = await request<{ url?: string; available?: boolean; error?: string }>("POST", "/billing/checkout", { price });
      if (body.available === false) return { available: false };
      if (status !== 200 || !body.url) throw new Error(body.error ?? "Checkout could not be started");
      return { url: body.url };
    },
    portal: async () => {
      const { status, body } = await request<{ url?: string; available?: boolean; error?: string }>("POST", "/billing/portal");
      if (body.available === false) return { available: false };
      if (status !== 200 || !body.url) throw new Error(body.error ?? "the billing portal could not be opened");
      return { url: body.url };
    },
    refreshEntitlements: async () => (await request<{ entitlements?: string[] }>("POST", "/billing/refresh")).body.entitlements ?? [],
    myPublisher: async () => (await request<{ publisher: PublisherView | null }>("GET", "/publishers/me")).body.publisher ?? null,
    becomePublisher: async (name) => {
      const { status, body } = await request<{ publisher?: PublisherView | null; error?: string }>("POST", "/publishers", { name });
      if (status !== 200 || !body.publisher) throw new Error(body.error ?? "that could not be set up");
      return body.publisher;
    },
    renamePublisher: async (name) => {
      const { status, body } = await request<{ publisher?: PublisherView | null; listings?: number; error?: string }>("PATCH", "/publishers", { name });
      if (status !== 200 || !body.publisher) throw new Error(body.error ?? "that name could not be changed");
      return { publisher: body.publisher, listings: body.listings ?? 0 };
    },
    connectPublisher: async () => {
      const { status, body } = await request<{ url?: string; available?: boolean; error?: string; publisher?: null }>("POST", "/publishers/connect");
      if (body.available === false) return { available: false };
      if (status !== 200 || !body.url) throw new Error(body.error ?? "payouts could not be set up just now");
      return { url: body.url };
    },
    refreshPublisherConnect: async () => (await request<{ publisher: PublisherView | null }>("POST", "/publishers/connect/refresh")).body.publisher ?? null,
    publisherMembers: async () => {
      const { body } = await request<{ members?: PublisherMember[]; invitations?: PublisherInvitation[]; available?: boolean }>("GET", "/publishers/members");
      return { members: body.members ?? [], invitations: body.invitations ?? [], ...(body.available === false ? { available: false as const } : {}) };
    },
    invitePublisherMember: async (email, role) => {
      const { status, body } = await request<{ invitation?: PublisherInvitation; available?: boolean; error?: string }>("POST", "/publishers/members/invite", { email, role });
      if (body.available === false) return { available: false };
      if (status !== 200 || !body.invitation) throw new Error(body.error ?? "the invitation could not be sent");
      return body.invitation;
    },
    revokePublisherInvitation: async (id) => {
      const { status, body } = await request<{ error?: string }>("DELETE", `/publishers/invitations/${encodeURIComponent(id)}`);
      if (status !== 200) throw new Error(body.error ?? "the invitation could not be revoked");
    },
    removePublisherMember: async (userId) => {
      const { status, body } = await request<{ error?: string }>("DELETE", `/publishers/members/${encodeURIComponent(userId)}`);
      if (status !== 200) throw new Error(body.error ?? "they could not be removed");
    },
    myInvitations: async () => (await request<{ invitations?: PublisherInvitation[] }>("GET", "/invitations")).body.invitations ?? [],
    revokeFriendInvitation: async (id) => {
      const { status, body } = await request<{ error?: string }>("DELETE", `/invitations/${encodeURIComponent(id)}`);
      if (status !== 200) throw new Error(body.error ?? "the invitation could not be taken back");
    },
    inviteFriend: async (email) => {
      const { status, body } = await request<{ sent?: boolean; email?: string; available?: boolean; error?: string }>("POST", "/invitations", { email });
      if (body.available === false) return { available: false };
      if (status !== 200 || !body.sent) throw new Error(body.error ?? "the invitation could not be sent");
      return { sent: true, email: body.email ?? email };
    },
    startPurchase: async (packId) => {
      const { status, body } = await request<{ url?: string; ref?: string; available?: boolean; found?: boolean; owned?: boolean; error?: string }>("POST", `/listings/${encodeURIComponent(packId)}/checkout`);
      if (body.owned === true) return { owned: true };
      if (body.available === false) return { available: false };
      if (body.found === false) return { found: false };
      if (status !== 200 || !body.url || !body.ref) throw new Error(body.error ?? "the purchase could not be started");
      return { url: body.url, ref: body.ref };
    },
    purchase: async (ref) => {
      const { body } = await request<{ found: boolean; purchase?: Purchase }>("GET", `/purchases/${encodeURIComponent(ref)}`);
      return body.found && body.purchase ? body.purchase : null;
    },
    purchaseFile: async (ref) => fetchBytes(`${root}/purchases/${encodeURIComponent(ref)}/file`, await getAccessToken()),
    myPurchases: async () => (await request<{ purchases?: Purchase[] }>("GET", "/me/purchases")).body.purchases ?? [],
    sales: async () => (await request<{ sales?: SaleRow[] }>("GET", "/publishers/sales")).body.sales ?? [],
    reissueSale: async (ref) => {
      const { status, body } = await request<{ sale?: SaleRow; error?: string }>("POST", `/publishers/sales/${encodeURIComponent(ref)}/reissue`);
      if (status !== 200 || !body.sale) throw new Error(body.error ?? "that could not be reissued");
      return body.sale;
    },
    revokeSale: async (ref) => {
      const { status, body } = await request<{ sale?: SaleRow; error?: string }>("POST", `/publishers/sales/${encodeURIComponent(ref)}/revoke`);
      if (status !== 200 || !body.sale) throw new Error(body.error ?? "that could not be revoked");
      return body.sale;
    },
    publisherPacks: async () => (await request<{ packs?: PublisherPack[] }>("GET", "/publishers/packs")).body.packs ?? [],
    putPublisherPack: async (packId, body) => {
      const { status, body: out } = await request<{ pack?: PublisherPack; error?: string }>("PUT", `/publishers/packs/${encodeURIComponent(packId)}`, body);
      if (status !== 200 || !out.pack) throw new Error(out.error ?? "the pack could not be uploaded");
      return out.pack;
    },
    listPublisherPack: async (packId, price) => {
      const { status, body } = await request<{ pack?: PublisherPack; available?: boolean; error?: string }>("POST", `/publishers/packs/${encodeURIComponent(packId)}/listing`, price ?? {});
      if (body.available === false) return { available: false };
      if (status !== 200 || !body.pack) throw new Error(body.error ?? "the pack could not be listed");
      return body.pack;
    },
    unlistPublisherPack: async (packId) => (await request<{ pack?: PublisherPack }>("DELETE", `/publishers/packs/${encodeURIComponent(packId)}/listing`)).body.pack ?? null,
    deletePublisherPack: async (packId) => {
      await request("DELETE", `/publishers/packs/${encodeURIComponent(packId)}`);
    },
    publisherDashboard: async () => {
      const { status, body } = await request<{ url?: string; available?: boolean; error?: string }>("POST", "/publishers/dashboard");
      if (body.available === false) return { available: false };
      if (status !== 200 || !body.url) throw new Error(body.error ?? "the dashboard could not be opened");
      return { url: body.url };
    },

    createRace: async (race) => {
      const { status, body } = await request<{ race?: RaceMeta; entries?: RaceEntry[]; error?: string; plan?: string }>("POST", "/races", race);
      if (status === 402 && body.plan) throw new PlanError(body.plan, body.error ?? "that is part of a plan this account does not have");
      if (status !== 200 || !body.race) throw new Error(body.error ?? "the race could not be started");
      return { meta: body.race, entries: body.entries ?? [] };
    },
    myRaces: async () => (await request<{ races?: Race[] }>("GET", "/races")).body.races ?? [],
    joinRace: async (code) => {
      const { status, body } = await request<{ race?: RaceMeta; entries?: RaceEntry[]; error?: string }>("POST", "/races/join", { code });
      if (status !== 200 || !body.race) throw new Error(body.error ?? "no race answers to that code");
      return { meta: body.race, entries: body.entries ?? [] };
    },
    getRace: async (id) => {
      const { status, body } = await request<{ found: boolean; race?: RaceMeta; entries?: RaceEntry[] }>("GET", `/races/${encodeURIComponent(id)}`);
      return status === 200 && body.found && body.race ? { meta: body.race, entries: body.entries ?? [] } : null;
    },
    putRaceEntry: async (id, patch) => {
      const { status, body } = await request<{ found?: boolean; race?: RaceMeta; entries?: RaceEntry[] }>("PUT", `/races/${encodeURIComponent(id)}/entries/me`, patch);
      return status === 200 && body.race ? { meta: body.race, entries: body.entries ?? [] } : null;
    },
    patchRace: async (id, patch) => {
      const { status, body } = await request<{ found?: boolean; race?: RaceMeta; entries?: RaceEntry[]; error?: string }>("PATCH", `/races/${encodeURIComponent(id)}`, patch);
      if (status === 422) throw new Error(body.error ?? "that could not be changed");
      return status === 200 && body.race ? { meta: body.race, entries: body.entries ?? [] } : null;
    },
    inviteToRace: async (id, email) => {
      const { status, body } = await request<{ link?: string; code?: string; error?: string }>("POST", `/races/${encodeURIComponent(id)}/invites`, { email });
      if (status !== 200 || !body.code) throw new Error(body.error ?? "the invitation could not be sent");
      return { link: body.link ?? "", code: body.code };
    },

    connections: async () => {
      const { body } = await request<{ available?: boolean; discord?: DiscordConnection | null; connections?: Connection[]; verify?: boolean }>("GET", "/connections");
      // A server written before an account could hold several sends the one
      // it has; the list is made from it so this page has one thing to read.
      const listed = body.connections ?? (body.discord ? [{ service: "discord" as const, accountId: body.discord.discordUserId, name: body.discord.name, linkedAt: body.discord.linkedAt }] : []);
      return { available: body.available === true, connections: listed, discord: body.discord ?? null, ...(body.verify === true ? { verify: true } : {}) };
    },
    linkDiscord: async (code) => {
      const { status, body } = await request<{ linked?: boolean; discord?: DiscordConnection; error?: string }>("POST", "/connections/discord", { code });
      if (status !== 200 || !body.discord) throw new SyncError("error", undefined, body.error ?? "that code could not be linked");
      return body.discord;
    },
    unlinkDiscord: async (accountId) => {
      await request("DELETE", accountId ? `/connections/discord/${encodeURIComponent(accountId)}` : "/connections/discord");
    },
    discordVerifyUrl: async () => {
      const { body } = await request<{ available?: boolean; url?: string }>("POST", "/connections/discord/verify");
      if (!body.url) throw new SyncError("error", undefined, "this copy of Runlog cannot verify with Discord");
      return body.url;
    },
    claimGuild: async (code) => {
      const { status, body } = await request<{ claimed?: boolean; guild?: Guild; plan?: string; upgrade?: boolean; error?: string }>("POST", "/guilds/claim", { code });
      if (status !== 200 || !body.guild) throw new SyncError("error", undefined, body.error ?? "that server could not be claimed");
      return { guild: body.guild, plan: body.plan ?? "server", upgrade: body.upgrade === true };
    },
    myGuilds: async () => {
      const { body } = await request<{ guilds?: Guild[]; server?: boolean; open?: boolean; allowed?: number }>("GET", "/guilds");
      // How many this account may claim is the plan's to say; a server
      // written before it said so meant three.
      return { guilds: body.guilds ?? [], server: body.server !== false, open: body.open === true, allowed: typeof body.allowed === "number" ? body.allowed : 3 };
    },
    releaseGuild: async (guildId) => {
      await request("DELETE", `/guilds/${encodeURIComponent(guildId)}`);
    },
    guildPacks: async (guildId) => (await request<{ packs?: GuildPackMeta[] }>("GET", `/guilds/${encodeURIComponent(guildId)}/packs`)).body.packs ?? [],
    delegatePack: async (guildId, pack) => {
      const { packId, ...rest } = pack;
      const { status, body } = await request<{ kept?: boolean; pack?: GuildPackMeta; error?: string }>("PUT", `/guilds/${encodeURIComponent(guildId)}/packs/${encodeURIComponent(packId)}`, rest);
      if (status !== 200 || !body.pack) throw new SyncError(status === 413 ? "too-large" : "error", undefined, body.error ?? "that pack could not be added");
      return body.pack;
    },
    undelegatePack: async (guildId, packId) => {
      await request("DELETE", `/guilds/${encodeURIComponent(guildId)}/packs/${encodeURIComponent(packId)}`);
    },
    createInvite: async (sessionId, email, role) => {
      const { status, body } = await request<{ invite?: Invite; link?: string; error?: string; plan?: string }>("POST", `/sessions/${sessionId}/invites`, { email, role });
      if (status === 402 && body.plan) throw new PlanError(body.plan, body.error ?? "that is part of a plan this account does not have");
      if (status !== 200 || !body.invite || !body.link) throw new SyncError("error", undefined, body.error ?? "the invitation was not sent");
      return { invite: body.invite, link: body.link };
    },
    listInvites: async (sessionId) => (await request<{ invites?: Invite[] }>("GET", `/sessions/${sessionId}/invites`)).body.invites ?? [],
    revokeInvite: async (sessionId, token) => {
      await request("DELETE", `/sessions/${sessionId}/invites/${encodeURIComponent(token)}`);
    },
    shareRun: async (sessionId) => {
      const { status, body } = await request<{ link?: string; error?: string; plan?: string }>("POST", `/sessions/${encodeURIComponent(sessionId)}/public`);
      if (status === 402 && body.plan) throw new PlanError(body.plan, body.error ?? "that is part of a plan this account does not have");
      if (status !== 200 || !body.link) throw new SyncError("error", undefined, body.error ?? "the run could not be shared");
      return { link: body.link };
    },
    watchPublicRun: async (sessionId, token) => {
      const { status, body } = await request<{ sessionId?: string; role?: "owner" | "player" | "viewer"; error?: string; found?: boolean }>("POST", `/public/runs/${encodeURIComponent(sessionId)}/watch?t=${encodeURIComponent(token)}`);
      if (status !== 200 || !body.sessionId || !body.role) throw new SyncError("error", undefined, body.error ?? (body.found === false ? "this link is not open any more" : "that seat could not be taken"));
      return { sessionId: body.sessionId, role: body.role };
    },
    reactions: async (sessionId) => (await request<{ reactions?: Reaction[] }>("GET", `/sessions/${encodeURIComponent(sessionId)}/reactions`)).body.reactions ?? [],
    react: async (sessionId, emoji) => {
      const { status, body } = await request<{ reactions?: Reaction[]; error?: string }>("POST", `/sessions/${encodeURIComponent(sessionId)}/reactions`, { emoji });
      if (status !== 200 || !body.reactions) throw new SyncError("error", undefined, body.error ?? "that did not land");
      return body.reactions;
    },
    unshareRun: async (sessionId) => {
      await request("DELETE", `/sessions/${encodeURIComponent(sessionId)}/public`);
    },
    asks: async (sessionId) => (await request<{ asks?: Ask[] }>("GET", `/sessions/${encodeURIComponent(sessionId)}/asks`)).body.asks ?? [],
    answerAsk: async (sessionId, askId, answer, reason) => {
      const { status, body } = await request<{ asks?: Ask[]; error?: string }>("POST", `/sessions/${encodeURIComponent(sessionId)}/asks/${encodeURIComponent(askId)}`, { answer, ...(reason ? { reason } : {}) });
      if (status !== 200 || !body.asks) throw new SyncError("error", undefined, body.error ?? "that answer did not land");
      return body.asks;
    },
    mintAskKey: async (sessionId, policy) => {
      const { status, body } = await request<{ key?: string; asks?: { policy: AskPolicy }; error?: string; plan?: string }>("POST", `/sessions/${encodeURIComponent(sessionId)}/ask-key`, policy ? { policy } : {});
      if (status === 402 && body.plan) throw new PlanError(body.plan, body.error ?? "that is part of a plan this account does not have");
      if (status !== 200 || !body.key) throw new SyncError("error", undefined, body.error ?? "no key could be made");
      return { key: body.key, policy: body.asks?.policy ?? "ask" };
    },
    setAskPolicy: async (sessionId, policy) => {
      const { status, body } = await request<{ error?: string }>("PUT", `/sessions/${encodeURIComponent(sessionId)}/ask-key`, { policy });
      if (status !== 200) throw new SyncError("error", undefined, body.error ?? "that did not take");
    },
    revokeAskKey: async (sessionId) => {
      await request("DELETE", `/sessions/${encodeURIComponent(sessionId)}/ask-key`);
    },
    streamKeys: async () => (await request<{ keys?: StreamKeys }>("GET", "/me/stream-keys")).body.keys ?? {},
    mintStreamKey: async (kind) => {
      const { status, body } = await request<{ key?: string; keys?: StreamKeys; error?: string; plan?: string }>("POST", "/me/stream-keys", { kind });
      if (status === 402 && body.plan) throw new PlanError(body.plan, body.error ?? "that is part of a plan this account does not have");
      if (status !== 200 || !body.key) throw new SyncError("error", undefined, body.error ?? "no key could be made");
      return { key: body.key, keys: body.keys ?? {} };
    },
    revokeStreamKey: async (kind) => (await request<{ keys?: StreamKeys }>("DELETE", `/me/stream-keys?kind=${kind}`)).body.keys ?? {},
    putSnapshot: async (sessionId, snapshot) => {
      await request("PUT", `/sessions/${encodeURIComponent(sessionId)}/snapshot`, { snapshot });
    },
    acceptInvite: async (token, email) => {
      const { status, body } = await request<{ sessionId?: string; alreadyIn?: boolean; error?: string }>("POST", `/invites/${encodeURIComponent(token)}/accept`, email ? { email } : {});
      if (status !== 200 || !body.sessionId) throw new SyncError("error", undefined, body.error ?? "that invitation could not be accepted");
      return { sessionId: body.sessionId, ...(body.alreadyIn ? { alreadyIn: true } : {}) };
    },
    myInvites: async () => {
      const { status, body } = await request<{ invites?: PendingInvite[] }>("GET", "/me/invites");
      return status === 200 ? (body.invites ?? []) : [];
    },
    declineInvite: async (token) => {
      await request("DELETE", `/me/invites/${encodeURIComponent(token)}`);
    },
    removeMember: async (sessionId, sub) => {
      await request("DELETE", `/sessions/${sessionId}/members/${encodeURIComponent(sub)}`);
    },
    people: async () => (await request<{ people?: Person[] }>("GET", "/people")).body.people ?? [],

    listKeys: async () => (await request<{ keys?: ApiKey[] }>("GET", "/keys")).body.keys ?? [],
    createKey: async (name, scope) => {
      const { status, body } = await request<{ key?: ApiKey; secret?: string; error?: string }>("POST", "/keys", { name, ...(scope ? { scope } : {}) });
      if (status !== 200 || !body.key || !body.secret) throw new SyncError("error", undefined, body.error ?? "the key was not made");
      return { key: body.key, secret: body.secret };
    },
    revokeKey: async (id) => {
      await request("DELETE", `/keys/${encodeURIComponent(id)}`);
    },
    listClaims: async () => (await request<{ claims?: Claim[] }>("GET", "/claims")).body.claims ?? [],
    removeClaim: async (fingerprint) => {
      await request("DELETE", `/claims/${encodeURIComponent(fingerprint)}`);
    },
    claimNonce: async () => (await request<{ nonce: string }>("POST", "/claims/nonce")).body,
    claim: async (publicKey, nonce, signature) => {
      const { status, body } = await request<{ claim?: Claim; error?: string }>("POST", "/claims", { publicKey, nonce, signature });
      if (status !== 200 || !body.claim) throw new SyncError("error", undefined, body.error ?? "the claim did not go through");
      return body.claim;
    },

    getPack: async (id) => {
      const { status, body } = await request<{ found: boolean; pack?: RemotePack }>("GET", `/packs/${id}`);
      return status === 200 && body.found && body.pack ? body.pack : null;
    },
    putPack: async (pack, ifMatch) =>
      (await request<{ entry: Entry }>("PUT", `/packs/${pack.id}`, pack, ifMatch ? { "if-match": ifMatch } : {}))
        .body.entry,
    deletePack: async (id) => {
      await request("DELETE", `/packs/${id}`);
    },

    getLicense: async (packId) => {
      const { status, body } = await request<{ found: boolean; license?: RemoteLicense }>(
        "GET",
        `/licenses/${packId}`,
      );
      return status === 200 && body.found && body.license ? body.license : null;
    },
    putLicense: async (license, ifMatch) =>
      (
        await request<{ entry: Entry }>(
          "PUT",
          `/licenses/${license.id}`,
          license,
          ifMatch ? { "if-match": ifMatch } : {},
        )
      ).body.entry,
    deleteLicense: async (packId) => {
      await request("DELETE", `/licenses/${packId}`);
    },
  };
}
