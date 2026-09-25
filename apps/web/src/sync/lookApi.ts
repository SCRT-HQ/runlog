import {
  LOOK_PUBLISHER_HEADER,
  LOOK_READ_HEADER,
  LOOK_READ_KEY_PATTERN,
  LOOK_SECRET_PATTERN,
  parseLookChannelSummary,
  parsePublicLook,
  type LookChannelSummaryV1,
  type PresentationSnapshotV1,
  type PublicLookV1,
} from "@runlog/themes";
import { SyncError, type Transport } from "./client.ts";

export type LookCreateOutcome =
  | { readonly kind: "ok"; readonly channel: LookChannelSummaryV1; readonly readKey: string; readonly secret: string }
  | { readonly kind: "plan" }
  | { readonly kind: "full"; readonly limit: number };
export type LookPublishOutcome =
  | { readonly kind: "ok"; readonly revision: number }
  | { readonly kind: "stale"; readonly revision: number }
  | { readonly kind: "not-publisher" }
  | { readonly kind: "gone" }
  | { readonly kind: "rate-limited"; readonly retryAfterMs: number }
  | { readonly kind: "rejected"; readonly code: string };
export type LookMoveOutcome<T> =
  ({ readonly kind: "ok"; readonly channel: LookChannelSummaryV1 } & T) | { readonly kind: "gone" } | { readonly kind: "plan" };
export interface LookApi {
  list(): Promise<readonly LookChannelSummaryV1[]>;
  create(): Promise<LookCreateOutcome>;
  publish(input: {
    readonly id: string;
    readonly secret: string;
    readonly base: number;
    readonly snapshot: PresentationSnapshotV1;
  }): Promise<LookPublishOutcome>;
  transfer(id: string): Promise<LookMoveOutcome<{ readonly secret: string }>>;
  relink(id: string): Promise<LookMoveOutcome<{ readonly readKey: string }>>;
  revoke(id: string): Promise<boolean>;
}
export type PublicLookAnswer =
  { readonly kind: "look"; readonly look: PublicLookV1 } | { readonly kind: "unpublished" } | { readonly kind: "gone" };

type Body = Record<string, unknown>;
const unreadable = () => new SyncError("error", undefined, "the server's theme link does not read");
const unexpected = (status: number) => new SyncError("error", undefined, `the server said ${status}`);

function summaryOf(value: unknown): LookChannelSummaryV1 {
  const parsed = parseLookChannelSummary(value);
  if (!parsed.ok) throw unreadable();
  return parsed.value;
}
function shaped(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) throw unreadable();
  return value;
}
const at = (id: string) => `/looks/${encodeURIComponent(id)}`;
/** The link itself is gone. Any other 410, such as a route this server does not have, is an error to retry. */
const revoked = (status: number, body: Body) => status === 410 && body["code"] === "gone";

/**
 * The owner's side of a theme link. The secret goes in a header and the
 * key comes back in a body; neither is ever part of an address, and
 * nothing here logs either.
 */
export function createLookApi(send: Transport): LookApi {
  return {
    async list() {
      const { status, body } = await send<Body>("GET", "/looks");
      if (status !== 200 || !Array.isArray(body["channels"])) throw unexpected(status);
      return (body["channels"] as unknown[]).map(summaryOf);
    },
    async create() {
      const { status, body } = await send<Body>("POST", "/looks");
      if (status === 402) return { kind: "plan" };
      if (status === 422 && body["code"] === "channel-limit") return { kind: "full", limit: Number(body["limit"]) };
      if (status !== 200) throw unexpected(status);
      return {
        kind: "ok",
        channel: summaryOf(body["channel"]),
        readKey: shaped(body["readKey"], LOOK_READ_KEY_PATTERN),
        secret: shaped(body["secret"], LOOK_SECRET_PATTERN),
      };
    },
    async publish({ id, secret, base, snapshot }) {
      const { status, body, headers } = await send<Body>(
        "PUT",
        at(id),
        { snapshot },
        { [LOOK_PUBLISHER_HEADER]: secret, "if-match": `"${base}"` },
      );
      const revision = body["revision"];
      if (status === 200 && Number.isSafeInteger(revision)) return { kind: "ok", revision: revision as number };
      if (status === 409 && body["code"] === "stale-revision" && Number.isSafeInteger(revision))
        return { kind: "stale", revision: revision as number };
      if (status === 409 && body["code"] === "not-publisher") return { kind: "not-publisher" };
      if (revoked(status, body)) return { kind: "gone" };
      if (status === 429 || status === 503) {
        const seconds = Number(body["retryAfter"] ?? headers.get("retry-after") ?? 60);
        return { kind: "rate-limited", retryAfterMs: Math.max(1, Number.isFinite(seconds) ? seconds : 60) * 1000 };
      }
      if (status === 413) return { kind: "rejected", code: "too-large" };
      if (status === 422 || status === 428)
        return { kind: "rejected", code: typeof body["code"] === "string" ? body["code"] : "invalid-look" };
      throw unexpected(status);
    },
    async transfer(id) {
      const { status, body } = await send<Body>("POST", `${at(id)}/transfer`);
      if (status === 402) return { kind: "plan" };
      if (revoked(status, body)) return { kind: "gone" };
      if (status !== 200) throw unexpected(status);
      return { kind: "ok", channel: summaryOf(body["channel"]), secret: shaped(body["secret"], LOOK_SECRET_PATTERN) };
    },
    async relink(id) {
      const { status, body } = await send<Body>("POST", `${at(id)}/relink`);
      if (status === 402) return { kind: "plan" };
      if (revoked(status, body)) return { kind: "gone" };
      if (status !== 200) throw unexpected(status);
      return { kind: "ok", channel: summaryOf(body["channel"]), readKey: shaped(body["readKey"], LOOK_READ_KEY_PATTERN) };
    },
    async revoke(id) {
      const { status, body } = await send<Body>("DELETE", at(id));
      if (status !== 200) throw unexpected(status);
      return body["revoked"] === true;
    },
  };
}

/** A widget's read of a theme link: no account, the key in a header. */
export async function fetchPublicLook(base: string, readKey: string, fetchImpl: typeof fetch = fetch): Promise<PublicLookAnswer> {
  let response: Response;
  try {
    response = await fetchImpl(`${base.replace(/\/$/, "")}/looks/public`, { cache: "no-store", headers: { [LOOK_READ_HEADER]: readKey } });
  } catch {
    throw new SyncError("offline");
  }
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) throw new SyncError("error", undefined, "no answer");
  if (response.status !== 200) throw unexpected(response.status);
  const body = (await response.json()) as Body;
  if (body["found"] !== true) return { kind: "gone" };
  if (body["look"] === null) return { kind: "unpublished" };
  const parsed = parsePublicLook(body["look"]);
  if (!parsed.ok) throw unreadable();
  return { kind: "look", look: parsed.value };
}
