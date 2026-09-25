import {
  LOOK_CHANNEL_ID_PATTERN,
  LOOK_CHANNEL_LIMITS,
  LOOK_PUBLISHER_HEADER,
  LOOK_READ_KEY_PATTERN,
  LOOK_SECRET_PATTERN,
  lookSnapshotBytes,
  parsePresentationSnapshot,
} from "@runlog/themes";
import { hashToken } from "./auth.js";
import { lookSummary, type LookStore } from "./looks.js";

/** One request to the owner's theme link routes, already past sign-in: `sub` is the caller and nothing else names an owner. */
export interface LookRequest {
  readonly method: string;
  readonly path: string;
  header(name: string): string | undefined;
  /** The parsed body; undefined when it did not parse or was over the limit and so was never parsed. */
  readonly body: unknown;
  readonly bytes: number;
  readonly sub: string;
  readonly at: string;
  /** The caller signed in with a command-line key rather than the app. */
  readonly viaKey: boolean;
}
export interface LookAnswer {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers?: Record<string, string>;
}
/** What a metric may say about a link: the category and the revision, never a key, a secret or a look. */
export interface LookOutcome {
  readonly outcome:
    "created" | "published" | "stale" | "not-publisher" | "gone" | "rate-limited" | "invalid" | "full" | "moved" | "relinked" | "revoked";
  readonly revision?: number;
}
export interface LookRouteDeps {
  readonly store: LookStore;
  /** Whether the caller may make or move a link: the live-link gate. */
  allowed(): Promise<boolean>;
  /** `bytes` random bytes as base64url, from a CSPRNG: the store keeps only an unsalted hash. */
  mint(bytes: number): string;
  /** Tell the widgets following a link to read it again (Task 4 wires it). */
  ring?(channelId: string, revision: number): Promise<void>;
  /** Forget the sockets following a link, after its read key changed or it was revoked. */
  unfollow?(channelId: string): Promise<void>;
  seen?(outcome: LookOutcome): void;
}

const answer = (status: number, body: Record<string, unknown>, headers?: Record<string, string>): LookAnswer => ({
  status,
  body,
  ...(headers ? { headers } : {}),
});
const NO_ROUTE = answer(410, { error: "no such route" });
const PLUS = answer(402, {
  error: "a theme link that follows this device from anywhere is part of Plus, like sharing a live link",
  plan: "plus",
  upgrade: true,
});
const GONE = answer(410, { error: "this theme link was revoked", code: "gone" });
const MAX = LOOK_CHANNEL_LIMITS.maxRequestBytes;
const TOO_BIG = answer(413, { error: "a look is at most 4 KB", code: "too-large" });

/** The revision the device last saw, from `If-Match: "<n>"`; 0 before the first publish. */
function baseOf(ifMatch: string | undefined): number | null {
  const text = ifMatch?.trim().replace(/^"|"$/g, "");
  if (text === undefined || !/^\d{1,15}$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function publish(req: LookRequest, id: string, deps: LookRouteDeps): Promise<LookAnswer> {
  const seen = deps.seen ?? (() => {});
  // Size first: an oversized body is refused before any header or the body is read.
  if (req.bytes > MAX) return TOO_BIG;
  const secret = req.header(LOOK_PUBLISHER_HEADER);
  if (!secret || !LOOK_SECRET_PATTERN.test(secret))
    return answer(422, { error: "only the device that publishes this link may send it a look", code: "secret-required" });
  const base = baseOf(req.header("if-match"));
  if (base === null)
    return answer(428, {
      error: 'send If-Match: "<revision>" with the revision this device last published',
      code: "precondition-required",
    });
  const body = req.body;
  if (!isRecord(body) || Object.keys(body).some((k) => k !== "snapshot")) {
    seen({ outcome: "invalid" });
    return answer(422, { error: "a look, as { snapshot }", code: "invalid-look" });
  }
  const parsed = parsePresentationSnapshot(body["snapshot"]);
  if (!parsed.ok) {
    seen({ outcome: "invalid" });
    return answer(422, {
      error: "this look does not read",
      code: "invalid-look",
      issues: parsed.issues.map(({ path, message }) => ({ path, message })),
    });
  }
  if (lookSnapshotBytes(parsed.value) > MAX) return TOO_BIG;

  const count = await deps.store.countPublish(req.sub, id, req.at);
  if (count > LOOK_CHANNEL_LIMITS.publishesPerMinute) {
    const retryAfter = 60 - new Date(req.at).getUTCSeconds();
    seen({ outcome: "rate-limited" });
    return answer(
      429,
      { error: "too many looks in a minute; the latest is sent again shortly", code: "rate-limited", retryAfter },
      { "retry-after": String(retryAfter) },
    );
  }

  const out = await deps.store.publish({ sub: req.sub, id, secretHash: hashToken(secret), base, snapshot: parsed.value, at: req.at });
  switch (out.kind) {
    case "published":
      seen({ outcome: "published", revision: out.revision });
      await deps.ring?.(id, out.revision);
      return answer(200, { revision: out.revision, publishedAt: req.at });
    case "stale":
      seen({ outcome: "stale", revision: out.revision });
      return answer(409, {
        error: "a newer look was published; send yours on that revision",
        code: "stale-revision",
        revision: out.revision,
      });
    case "not-publisher":
      seen({ outcome: "not-publisher" });
      return answer(409, { error: "another device publishes this link now", code: "not-publisher" });
    case "gone":
      seen({ outcome: "gone" });
      return GONE;
  }
}

export async function lookRoute(req: LookRequest, deps: LookRouteDeps): Promise<LookAnswer> {
  const seen = deps.seen ?? (() => {});
  // A command-line key could otherwise take a link over from the device that publishes it.
  if (req.viaKey) return answer(422, { error: "make and move theme links from the app, signed in", code: "signed-in-only" });

  if (req.path === "/api/looks") {
    if (req.method === "GET") {
      const rows = await deps.store.list(req.sub);
      return answer(200, { channels: rows.map(lookSummary), limit: LOOK_CHANNEL_LIMITS.maxChannels });
    }
    if (req.method !== "POST") return NO_ROUTE;
    if (!(await deps.allowed())) return PLUS;
    const id = `lk_${deps.mint(12)}`;
    const readKey = deps.mint(24);
    const secret = deps.mint(32);
    const made = await deps.store.create({ sub: req.sub, id, readKeyHash: hashToken(readKey), secretHash: hashToken(secret), at: req.at });
    if (made === "full") {
      seen({ outcome: "full" });
      return answer(422, {
        error: `this account holds ${LOOK_CHANNEL_LIMITS.maxChannels} theme links; revoke one to make another`,
        code: "channel-limit",
        limit: LOOK_CHANNEL_LIMITS.maxChannels,
      });
    }
    const row = await deps.store.get(req.sub, id);
    if (!row) throw new Error("a theme link just made cannot be read");
    seen({ outcome: "created" });
    // The one time the read key and the secret are said.
    return answer(200, { channel: lookSummary(row), readKey, secret });
  }

  const m = /^\/api\/looks\/([^/]+)(?:\/(transfer|relink))?$/.exec(req.path);
  if (!m || !LOOK_CHANNEL_ID_PATTERN.test(m[1]!)) return NO_ROUTE;
  const id = m[1]!;
  const action = m[2];

  if (action === undefined) {
    if (req.method === "PUT") return publish(req, id, deps);
    if (req.method !== "DELETE") return NO_ROUTE;
    const revoked = await deps.store.remove(req.sub, id);
    if (revoked) {
      seen({ outcome: "revoked" });
      // After the rows are gone: a widget that reads again on this ring finds nothing.
      await deps.ring?.(id, 0);
      // Then nobody is left following a link that no longer exists.
      await deps.unfollow?.(id);
    }
    return answer(200, { revoked });
  }

  if (req.method !== "POST") return NO_ROUTE;
  if (!(await deps.allowed())) return PLUS;
  if (action === "transfer") {
    const secret = deps.mint(32);
    if (!(await deps.store.rotateSecret({ sub: req.sub, id, secretHash: hashToken(secret), at: req.at }))) return GONE;
    const row = await deps.store.get(req.sub, id);
    if (!row) return GONE;
    seen({ outcome: "moved", revision: row.revision });
    return answer(200, { channel: lookSummary(row), secret });
  }
  const readKey = deps.mint(24);
  if (!(await deps.store.relink({ sub: req.sub, id, readKeyHash: hashToken(readKey), at: req.at }))) return GONE;
  const row = await deps.store.get(req.sub, id);
  if (!row) return GONE;
  seen({ outcome: "relinked", revision: row.revision });
  // Widgets on the old address read again, find nothing, and fall back.
  await deps.ring?.(id, row.revision);
  // Their follows went with the old key; a widget on the new address follows again.
  await deps.unfollow?.(id);
  return answer(200, { channel: lookSummary(row), readKey });
}

/**
 * What a widget reads: the look and its revision, by the read key its
 * address carries. Nothing here says whose link it is, which link, or
 * when it moved, and a key that opens nothing looks like every other.
 */
export async function publicLook(readKey: string | undefined, store: Pick<LookStore, "byReadKey" | "get">): Promise<LookAnswer> {
  if (!readKey || !LOOK_READ_KEY_PATTERN.test(readKey)) return answer(200, { found: false });
  const hash = hashToken(readKey);
  const at = await store.byReadKey(hash);
  // The pointer alone is not enough: the link row must still be there and still hold this key.
  const row = at ? await store.get(at.sub, at.id) : null;
  if (!row || row.readKeyHash !== hash) return answer(200, { found: false });
  if (row.snapshot === null || row.revision === 0) return answer(200, { found: true, look: null });
  return answer(200, { found: true, look: { schemaVersion: 1, revision: row.revision, snapshot: row.snapshot } });
}
