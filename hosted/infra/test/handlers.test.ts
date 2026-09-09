import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { finishDeferred, finishMoved, finishTimer, route, type Deps } from "../lib/handlers/api";
import type { TimerJob } from "../lib/handlers/discord/play";
import { SeqConflict, type ApiKey, type Claim, type Invite, type LicenseMeta, type PackMeta, type Person, type Profile, type Reaction, type SessionMember, type SessionMeta, type SessionPointer, type Store, type StoredEvent } from "../lib/handlers/store";
import type { Race, RaceEntry, RaceMeta, RaceStore } from "../lib/handlers/races";
import type { BillingStore } from "../lib/handlers/billing";
import type { StripeLike } from "../lib/handlers/stripe";
import type { Publisher, PublisherStore } from "../lib/handlers/publishers";
import type { WorkOSLike } from "../lib/handlers/workos";
import type { ListingCard, ListingStore, Product } from "../lib/handlers/listings";
import type { Sale, SaleStore } from "../lib/handlers/sales";
import { open, readHeader } from "../lib/handlers/container";
import { memoryDiscord, memoryGuilds } from "./memory-guilds";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function memorySales(): SaleStore & { sealed: Map<string, Uint8Array> } {
  const sales = new Map<string, Sale>();
  const sealed = new Map<string, Uint8Array>();
  return {
    sealed,
    async putSale(s) {
      sales.set(s.ref, { ...s });
    },
    async getSale(ref) {
      const s = sales.get(ref);
      return s ? { ...s } : null;
    },
    async listSales(orgId) {
      return [...sales.values()].filter((s) => s.orgId === orgId).map((s) => ({ ...s }));
    },
    async listPurchases(sub) {
      return [...sales.values()].filter((s) => s.buyerSub === sub).map((s) => ({ ...s }));
    },
    async putSealed(orgId, ref, data) {
      const key = `orgs/${orgId}/sales/${ref}.rlpack`;
      sealed.set(key, data);
      return key;
    },
    async getSealed(key) {
      return sealed.get(key) ?? new Uint8Array();
    },
  };
}

function memoryListings(): ListingStore {
  const products = new Map<string, Product>();
  const cards = new Map<string, ListingCard>();
  const masters = new Map<string, string>();
  return {
    async putProduct(p) {
      products.set(`${p.orgId}/${p.packId}`, { ...p });
    },
    async getProduct(orgId, packId) {
      const p = products.get(`${orgId}/${packId}`);
      return p ? { ...p } : null;
    },
    async listProducts(orgId) {
      return [...products.values()].filter((p) => p.orgId === orgId).map((p) => ({ ...p }));
    },
    async deleteProduct(orgId, packId) {
      products.delete(`${orgId}/${packId}`);
    },
    async putCard(c) {
      cards.set(c.packId, { ...c });
    },
    async getCard(packId) {
      const c = cards.get(packId);
      return c ? { ...c } : null;
    },
    async deleteCard(packId) {
      cards.delete(packId);
    },
    async listCards() {
      return [...cards.values()].map((c) => ({ ...c }));
    },
    async putMaster(orgId, packId, source) {
      const key = `orgs/${orgId}/masters/${packId}.yaml`;
      masters.set(key, source);
      return { key, bytes: Buffer.byteLength(source) };
    },
    async getMaster(key) {
      return masters.get(key) ?? "";
    },
  };
}

function memoryPublishers(): PublisherStore {
  const orgs = new Map<string, Publisher>();
  const members = new Map<string, string>();
  const roles = new Map<string, "admin" | "member">();
  const accounts = new Map<string, string>();
  return {
    async createPublisher(p, at) {
      const made: Publisher = { ...p, createdAt: at, updatedAt: at, connectReady: false };
      orgs.set(p.id, made);
      members.set(p.ownerSub, p.id);
      return { ...made };
    },
    async getPublisher(id) {
      const p = orgs.get(id);
      return p ? { ...p } : null;
    },
    async publisherOf(sub) {
      const id = members.get(sub);
      return id ? { ...orgs.get(id)! } : null;
    },
    async publisherForAccount(accountId) {
      return accounts.get(accountId) ?? null;
    },
    async addMember(id, sub, role) {
      members.set(sub, id);
      roles.set(`${id}|${sub}`, role);
    },
    async removeMember(id, sub) {
      members.delete(sub);
      roles.delete(`${id}|${sub}`);
    },
    async roleOf(id, sub) {
      return roles.get(`${id}|${sub}`) ?? null;
    },
    async setConnect(id, at, patch) {
      const p = orgs.get(id);
      if (!p) return null;
      Object.assign(p, patch, { updatedAt: at });
      if (patch.connectAccountId) accounts.set(patch.connectAccountId, id);
      return { ...p };
    },
  };
}

function fakeWorkOS(): WorkOSLike & { calls: string[]; accept: (organizationId: string, userId: string, role: "admin" | "member") => void } {
  const calls: string[] = [];
  const members: Array<{ organizationId: string; membershipId: string; userId: string; role: "admin" | "member" }> = [];
  const invitations: Array<{ id: string; email: string; state: "pending" | "accepted" | "expired" | "revoked"; expiresAt: string; organizationId: string; inviterUserId: string }> = [];
  return {
    calls,
    async createOrganization(name) {
      calls.push(`org ${name}`);
      return { id: `org_${name.toLowerCase().replace(/\W+/g, "-")}` };
    },
    async addMember(organizationId, userId, role) {
      calls.push(`member ${organizationId} ${userId} ${role}`);
      members.push({ organizationId, membershipId: `om_${userId}`, userId, role });
    },
    async listMembers(organizationId) {
      return members.filter((m) => m.organizationId === organizationId).map((m) => ({ membershipId: m.membershipId, userId: m.userId, role: m.role, email: `${m.userId}@example.com` }));
    },
    async membershipsOf(userId) {
      return members.filter((m) => m.userId === userId).map((m) => ({ organizationId: m.organizationId, membershipId: m.membershipId, role: m.role }));
    },
    async removeMember(membershipId) {
      calls.push(`remove ${membershipId}`);
      const at = members.findIndex((m) => m.membershipId === membershipId);
      if (at >= 0) members.splice(at, 1);
    },
    async listInvitations(organizationId) {
      return invitations.filter((i) => i.organizationId === organizationId && i.state === "pending").map(({ organizationId: _o, ...i }) => i);
    },
    async invitationsBy(userId) {
      return invitations.filter((i) => i.inviterUserId === userId && !i.organizationId).map(({ organizationId: _o, inviterUserId: _u, ...i }) => i);
    },
    async invite({ email, organizationId, role, inviterUserId }) {
      calls.push(`invite ${email} ${organizationId ?? "platform"} ${role ?? "-"} by ${inviterUserId}`);
      const made = { id: `inv_${invitations.length + 1}`, email, state: "pending" as const, expiresAt: "2026-09-14T00:00:00Z", organizationId: organizationId ?? "", inviterUserId };
      invitations.push(made);
      const { organizationId: _o, ...out } = made;
      return out;
    },
    async revokeInvitation(invitationId) {
      calls.push(`revoke ${invitationId}`);
      const found = invitations.find((i) => i.id === invitationId);
      if (found) found.state = "revoked";
    },
    /** A test's hand on WorkOS's book: someone accepted an invitation. */
    accept(organizationId: string, userId: string, role: "admin" | "member") {
      members.push({ organizationId, membershipId: `om_${userId}`, userId, role });
    },
  };
}

/** Billing rows, in Maps. */
function memoryBilling(): BillingStore & { rows: Map<string, string[]> } {
  const customers = new Map<string, string>();
  const users = new Map<string, string>();
  const entitlements = new Map<string, string[]>();
  const flags = new Map<string, string[]>();
  const seen = new Set<string>();
  return {
    rows: entitlements,
    async customerOf(sub) {
      return customers.get(sub) ?? null;
    },
    async setCustomer(sub, id) {
      customers.set(sub, id);
      users.set(id, sub);
    },
    async userForCustomer(id) {
      return users.get(id) ?? null;
    },
    async putEntitlements(sub, features) {
      entitlements.set(sub, features);
    },
    async entitlements(sub) {
      return entitlements.get(sub) ?? [];
    },
    async putFlags(sub, f) {
      flags.set(sub, f);
    },
    async flags(sub) {
      return flags.get(sub) ?? [];
    },
    async seenWebhook(id) {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    },
  };
}

/** Stripe, as a list of what was asked of it. */
function fakeStripe(): StripeLike & { calls: string[]; features: string[]; ready: boolean } {
  const calls: string[] = [];
  return {
    calls,
    features: ["plus"],
    async createCustomer(input) {
      calls.push(`customer ${input.metadata["workos_user_id"]}`);
      return { id: `cus_${input.metadata["workos_user_id"]}` };
    },
    async checkout(input) {
      calls.push(`checkout ${input.customer} ${input.price}`);
      return { url: `https://checkout.stripe.test/${input.price}` };
    },
    async portal(input) {
      calls.push(`portal ${input.customer}`);
      return { url: "https://portal.stripe.test/" };
    },
    async activeEntitlements(customer) {
      calls.push(`entitlements ${customer}`);
      return this.features;
    },
    constructEvent(rawBody, signature) {
      if (signature !== "good") throw new Error("bad signature");
      return JSON.parse(rawBody) as { id: string; type: string; data: { object: Record<string, unknown> } };
    },
    async createConnectedAccount(input) {
      calls.push(`connect ${input.metadata["runlog_publisher"]}`);
      return { id: `acct_${input.metadata["runlog_publisher"]}` };
    },
    async onboardingLink(input) {
      calls.push(`onboard ${input.account}`);
      return { url: `https://connect.stripe.test/${input.account}` };
    },
    async connectedAccount(id) {
      calls.push(`account ${id}`);
      return { chargesEnabled: this.ready, detailsSubmitted: this.ready };
    },
    async dashboardLink(account) {
      return { url: `https://dashboard.stripe.test/${account}` };
    },
    async createListing(input) {
      calls.push(`listing ${input.account} ${input.packId} ${input.amount} ${input.currency}${input.productId ? " again" : ""}`);
      return { productId: input.productId ?? `prod_${input.packId}`, priceId: `price_${input.packId}_${input.amount}` };
    },
    async retirePrice(input) {
      calls.push(`retire ${input.priceId}`);
    },
    async checkoutSale(input) {
      calls.push(`sale ${input.account} ${input.price} fee ${input.fee} ref ${input.ref}`);
      return { url: `https://checkout.stripe.test/sale/${input.ref}`, sessionId: `cs_${input.ref}` };
    },
    ready: false,
  };
}

/** Races, in a Map, with the same rules as the real one. */
function memoryRaces(): RaceStore {
  const races = new Map<string, Race>();
  const copy = (r: Race): Race => ({ meta: { ...r.meta }, entries: r.entries.map((e) => ({ ...e })) });
  const touch = (r: Race, at: string) => {
    r.meta.updatedAt = at;
    r.meta.seq += 1;
  };
  return {
    async createRace(meta, at, owner) {
      if (races.has(meta.id)) return null;
      const r: Race = { meta: { ...meta, createdAt: at, updatedAt: at, seq: 0 } as RaceMeta, entries: [{ sub: meta.ownerSub, joinedAt: at, ...(owner.name ? { name: owner.name } : {}), ...(owner.sessionId ? { sessionId: owner.sessionId } : {}) }] };
      races.set(meta.id, r);
      return copy(r);
    },
    async getRace(id) {
      const r = races.get(id);
      return r ? copy(r) : null;
    },
    async raceByCode(code) {
      return [...races.values()].find((r) => r.meta.code === code)?.meta.id ?? null;
    },
    async joinRace(id, sub, name, at) {
      const r = races.get(id);
      if (!r || r.meta.endedAt) return null;
      if (!r.entries.some((e) => e.sub === sub)) {
        r.entries.push({ sub, joinedAt: at, ...(name ? { name } : {}) });
        touch(r, at);
      }
      return copy(r);
    },
    async updateEntry(id, sub, at, patch) {
      const r = races.get(id);
      const e = r?.entries.find((x) => x.sub === sub);
      if (!r || !e) return null;
      Object.assign(e, patch as Partial<RaceEntry>);
      touch(r, at);
      return copy(r);
    },
    async updateRace(id, at, patch) {
      const r = races.get(id);
      if (!r) return null;
      r.meta = { ...r.meta, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.endedAt ? { endedAt: patch.endedAt } : {}) };
      if (patch.name === "") delete r.meta.name;
      touch(r, at);
      return copy(r);
    },
    async listRaces(sub) {
      return [...races.values()].filter((r) => r.entries.some((e) => e.sub === sub)).map(copy);
    },
  };
}
import { webcrypto } from "node:crypto";

/**
 * The API's rules, against a store that lives in a Map.
 *
 * The property that matters most is the one the template cannot show: every
 * request is checked, and a bad token is a 401. The second is that nothing
 * here ever answers 403 or 404, because CloudFront would turn either into
 * the app's index page with a 200 on the front.
 */

function memoryStore(): Store & { rows: Map<string, unknown>; exports: Map<string, string> } {
  const packs = new Map<string, { meta: PackMeta; source: string }>();
  const sessions = new Map<string, { meta: SessionMeta; members: SessionMember[]; events: StoredEvent[]; seen: Set<string> }>();
  const snapshots = new Map<string, { at: string; snapshot: unknown }>();
  const licenses = new Map<string, { meta: LicenseMeta; key: string }>();
  const profiles = new Map<string, Profile>();
  const invites = new Map<string, Invite>();
  const exports = new Map<string, string>();
  const reactions = new Map<string, Reaction[]>();
  const people = new Map<string, Map<string, Person>>();
  const counters = new Map<string, number>();
  const apiKeys = new Map<string, { sub: string; key: ApiKey; hash: string }>();
  const nonces = new Set<string>();
  const claims = new Map<string, Claim>();
  const k = (sub: string, id: string) => `${sub}/${id}`;
  const mine = (sub: string) => (key: string) => key.startsWith(`${sub}/`);
  return {
    rows: packs,
    exports,
    async getProfile(sub) {
      return profiles.get(sub) ?? null;
    },
    async touchProfile(sub, at, snapshot = {}) {
      const profile: Profile = {
        ...(profiles.get(sub) ?? { createdAt: at }),
        lastSeenAt: at,
        ...snapshot,
        ...(snapshot.termsVersion !== undefined ? { termsAcceptedAt: at } : {}),
        ...(snapshot.handle !== undefined ? { handleSetAt: at } : {}),
      };
      profiles.set(sub, profile);
      return profile;
    },
    async setMemberName(sessionId, sub, name) {
      const seat = sessions.get(sessionId)?.members.find((m) => m.sub === sub);
      if (!seat) return;
      if (name) seat.name = name;
      else delete seat.name;
    },
    async entitlements() {
      return [];
    },
    async saveExport(sub, body, at) {
      exports.set(sub, body);
      return { url: `https://export.test/${sub}`, expiresAt: at };
    },
    async deleteUser(sub) {
      let n = 0;
      for (const s of sessions.values()) {
        if (s.members.some((m) => m.sub === sub)) {
          s.members = s.members.filter((m) => m.sub !== sub);
          n += 1;
        }
      }
      for (const m of [packs, licenses] as Map<string, unknown>[]) {
        for (const key of [...m.keys()].filter(mine(sub))) {
          m.delete(key);
          n += 1;
        }
      }
      if (profiles.delete(sub)) n += 1;
      return n;
    },
    async manifest(sub) {
      return {
        packs: [...packs.entries()].filter(([key]) => key.startsWith(`${sub}/`)).map(([, v]) => v.meta),
        sessions: [...sessions.values()]
          .filter((s) => s.members.some((m) => m.sub === sub))
          .map((s): SessionPointer => ({
            id: s.meta.id, role: s.members.find((m) => m.sub === sub)!.role, packId: s.meta.packId, packVersion: s.meta.packVersion,
            ownerSub: s.meta.ownerSub, updatedAt: s.meta.updatedAt, seq: s.meta.seq,
            ...(s.meta.name ? { name: s.meta.name } : {}), ...(s.meta.deletedAt ? { deletedAt: s.meta.deletedAt } : {}),
          })),
        licenses: [...licenses.entries()].filter(([key]) => key.startsWith(`${sub}/`)).map(([, v]) => v.meta),
      };
    },
    async getPack(sub, id) {
      return packs.get(k(sub, id)) ?? null;
    },
    async putPack(sub, meta, source) {
      packs.set(k(sub, meta.id), { meta, source });
    },
    async deletePack(sub, id, at) {
      const existing = packs.get(k(sub, id));
      const meta: PackMeta = {
        ...(existing?.meta ?? { id, title: "", version: "", format: "yaml", filename: "", importedAt: at, hash: "", bytes: 0 }),
        updatedAt: at,
        deletedAt: existing?.meta.deletedAt ?? at,
        bytes: 0,
      };
      packs.set(k(sub, id), { meta, source: "" });
      return meta;
    },
    async createSession(meta, at, ownerName, events) {
      if (sessions.has(meta.id)) return null;
      const s = {
        meta: { ...meta, createdAt: at, updatedAt: at, seq: 0 } as SessionMeta,
        members: [{ sub: meta.ownerSub, role: "owner" as const, joinedAt: at, ...(ownerName ? { name: ownerName } : {}) }],
        events: [] as StoredEvent[],
        seen: new Set<string>(),
      };
      sessions.set(meta.id, s);
      const { appended } = await this.appendEvents(meta.id, meta.ownerSub, at, events);
      return { meta: s.meta, events: appended };
    },
    async getSession(id) {
      const s = sessions.get(id);
      return s ? { meta: s.meta, members: s.members } : null;
    },
    async eventsAfter(id, after) {
      return (sessions.get(id)?.events ?? []).filter((e) => e.seq > after);
    },
    async appendEvents(id, author, at, events, opts = {}) {
      const s = sessions.get(id)!;
      if (opts.expectSeq !== undefined && s.meta.seq !== opts.expectSeq) throw new SeqConflict(opts.expectSeq);
      const appended: StoredEvent[] = [];
      for (const e of events) {
        const eid = String(e["id"]);
        if (s.seen.has(eid)) continue;
        s.seen.add(eid);
        s.meta.seq += 1;
        const stored = { ...e, id: eid, seq: s.meta.seq, author };
        s.events.push(stored);
        appended.push(stored);
      }
      s.meta.updatedAt = at;
      return { appended, seq: s.meta.seq };
    },
    async updateSession(id, at, patch) {
      const s = sessions.get(id);
      if (!s) return null;
      s.meta = { ...s.meta, updatedAt: at, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.endedAt ? { endedAt: patch.endedAt } : {}) };
      if (patch.publicTokenHash === null) {
        delete s.meta.publicTokenHash;
        delete s.meta.publicAt;
      } else if (patch.publicTokenHash) {
        s.meta.publicTokenHash = patch.publicTokenHash;
        s.meta.publicAt = at;
      }
      return s.meta;
    },
    async putSnapshot(id, at, snapshot) {
      snapshots.set(id, { at, snapshot });
    },
    async getSnapshot(id) {
      return snapshots.get(id) ?? null;
    },
    async deleteSession(id, sub, at) {
      const s = sessions.get(id);
      const me = s?.members.find((m) => m.sub === sub);
      if (!s || !me) return null;
      if (me.role !== "owner") {
        s.members = s.members.filter((m) => m.sub !== sub);
        return { left: true };
      }
      s.meta = { ...s.meta, deletedAt: at, updatedAt: at };
      return { deletedAt: at };
    },
    async createInvite(invite) {
      invites.set(invite.token, invite);
    },
    async getInvite(token) {
      return invites.get(token) ?? null;
    },
    async listInvites(sessionId) {
      return [...invites.values()].filter((i) => i.sessionId === sessionId);
    },
    async invitesFor(email) {
      return [...invites.values()].filter((i) => i.email === email.toLowerCase());
    },
    async revokeInvite(_sessionId, token) {
      invites.delete(token);
    },
    async joinAsViewer(id, sub, name, at) {
      return this.joinAs(id, sub, "viewer", name, at);
    },
    async joinAs(id, sub, role, name, at) {
      const s = sessions.get(id);
      if (!s || s.meta.deletedAt) return null;
      const already = s.members.find((m) => m.sub === sub);
      if (already) return { role: already.role };
      s.members.push({ sub, role, joinedAt: at, ...(name ? { name } : {}) });
      return { role };
    },
    async addReaction(id, reaction) {
      const kept = [...(reactions.get(id) ?? []), reaction].slice(-30);
      reactions.set(id, kept);
      return kept;
    },
    async listReactions(id) {
      return reactions.get(id) ?? [];
    },
    async acceptInvite(token, sub, name, email, at) {
      const invite = invites.get(token);
      if (!invite || (invite.acceptedBy && invite.acceptedBy !== sub)) return null;
      const s = sessions.get(invite.sessionId);
      if (!s || s.meta.deletedAt) return null;
      if (!s.members.some((m) => m.sub === sub)) s.members.push({ sub, role: invite.role, joinedAt: at, ...(name ? { name } : {}) });
      invites.set(token, { ...invite, acceptedBy: sub, acceptedAt: at });
      for (const m of s.members) {
        if (m.sub === sub) continue;
        const mine = people.get(sub) ?? new Map<string, Person>();
        mine.set(m.sub, { sub: m.sub, lastPlayedAt: at, ...(m.name ? { name: m.name } : {}) });
        people.set(sub, mine);
        const theirs = people.get(m.sub) ?? new Map<string, Person>();
        theirs.set(sub, { sub, lastPlayedAt: at, ...(name ? { name } : {}), ...(email ? { email } : {}) });
        people.set(m.sub, theirs);
      }
      return { sessionId: invite.sessionId };
    },
    async removeMember(sessionId, sub) {
      const s = sessions.get(sessionId);
      const m = s?.members.find((x) => x.sub === sub);
      if (!s || !m || m.role === "owner") return false;
      s.members = s.members.filter((x) => x.sub !== sub);
      return true;
    },
    async listPeople(sub) {
      return [...(people.get(sub)?.values() ?? [])];
    },
    async countInvite(sub, at) {
      const key = `${sub}/${at.slice(0, 13)}`;
      const n = (counters.get(key) ?? 0) + 1;
      counters.set(key, n);
      return n;
    },
    async createApiKey(sub, key, hash) {
      apiKeys.set(key.id, { sub, key, hash });
    },
    async listApiKeys(sub) {
      return [...apiKeys.values()].filter((x) => x.sub === sub).map((x) => x.key);
    },
    async revokeApiKey(sub, id) {
      const x = apiKeys.get(id);
      if (!x || x.sub !== sub) return false;
      apiKeys.delete(id);
      return true;
    },
    async callerForApiKey(hash, at) {
      const x = [...apiKeys.values()].find((y) => y.hash === hash);
      if (!x) return null;
      x.key.lastUsedAt = at;
      return { sub: x.sub, id: x.key.id, ...(x.key.scope ? { scope: x.key.scope } : {}) };
    },
    async issueNonce(sub, nonce) {
      nonces.add(`${sub}/${nonce}`);
    },
    async takeNonce(sub, nonce) {
      return nonces.delete(`${sub}/${nonce}`);
    },
    async claim(c) {
      claims.set(c.fingerprint, c);
    },
    async getClaim(fingerprint) {
      return claims.get(fingerprint) ?? null;
    },
    async listClaims(sub) {
      return [...claims.values()].filter((c) => c.sub === sub);
    },
    async unclaim(sub, fingerprint) {
      const c = claims.get(fingerprint);
      if (!c || c.sub !== sub) return false;
      claims.delete(fingerprint);
      return true;
    },
    async getLicense(sub, packId) {
      return licenses.get(k(sub, packId)) ?? null;
    },
    async putLicense(sub, meta, key) {
      licenses.set(k(sub, meta.id), { meta, key });
    },
    async deleteLicense(sub, packId, at) {
      const existing = licenses.get(k(sub, packId));
      const meta: LicenseMeta = {
        ...(existing?.meta ?? { id: packId, hash: "" }),
        updatedAt: at,
        deletedAt: existing?.meta.deletedAt ?? at,
      };
      licenses.set(k(sub, packId), { meta, key: "" });
      return meta;
    },
  };
}

/** Mail as a list. */
function fakeMail() {
  const sent: Array<{ to: string; link: string; role: string; pack: string }> = [];
  const receipts: Array<{ to: string; link: string; key: string; pack: string }> = [];
  return {
    sent,
    receipts,
    mailer: {
      invite: async (to: string, t: { link: string; role: string; pack: string }) => void sent.push({ to, link: t.link, role: t.role, pack: t.pack }),
      purchase: async (to: string, t: { link: string; key: string; pack: string }) => void receipts.push({ to, link: t.link, key: t.key, pack: t.pack }),
    },
  };
}

function deps(store = memoryStore(), extra: Partial<Deps> = {}): Deps {
  let tokens = 0;
  return {
    store,
    races: memoryRaces(),
    billing: memoryBilling(),
    publishers: memoryPublishers(),
    listings: memoryListings(),
    sales: memorySales(),
    gates: false,
    verify: async (authorization) => {
      if (authorization === "Bearer good") return { sub: "user_1", sid: "session_1" };
      if (authorization === "Bearer guest") return { sub: "user_2", sid: "session_2" };
      throw new Error("bad token");
    },
    env: "test",
    cliClientId: "client_cli_test",
    now: () => "2026-09-06T12:00:00.000Z",
    appUrl: "https://runlog.test/",
    token: () => `tok${(tokens += 1)}`,
    ...extra,
  };
}

function request(
  method: string,
  path: string,
  { body, headers = {}, token = "good" }: { body?: unknown; headers?: Record<string, string>; token?: string | null } = {},
): APIGatewayProxyEventV2 {
  // API Gateway splits the query off the path; so does this.
  const [rawPath = "", rawQueryString = ""] = path.split("?");
  const queryStringParameters = Object.fromEntries(new URLSearchParams(rawQueryString));
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath,
    rawQueryString,
    ...(rawQueryString ? { queryStringParameters } : {}),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    requestContext: { http: { method, path: rawPath } } as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  } as APIGatewayProxyEventV2;
}

async function call(event: APIGatewayProxyEventV2, d = deps()) {
  const out = await route(event, d);
  if (typeof out === "string" || !out.body) throw new Error("expected a JSON result");
  return { status: out.statusCode, body: JSON.parse(out.body) as Record<string, unknown> };
}

const started = { t: "RunStarted", at: "2026-09-06T00:00:00Z", id: "e0", packId: "p", packVersion: "1", runId: "01RUN" };
const entered = { t: "UnitEntered", at: "2026-09-06T00:01:00Z", id: "e1" };
const sessionBody = { id: "01RUN", packId: "p", packVersion: "1", packTitle: "The Pack", events: [started, entered] };
const packBody = { title: "T", version: "1", format: "yaml", filename: "t.yaml", importedAt: "2026-09-06T00:00:00Z", updatedAt: "2026-09-06T00:00:00Z", hash: "h1", source: "id: p" };

describe("who is asking", () => {
  it("refuses without a token, with a 401 and not a 403", async () => {
    expect((await call(request("GET", "/api/me", { token: null }))).status).toBe(401);
    expect((await call(request("GET", "/api/me", { token: "bad" }))).status).toBe(401);
  });

  it("tells the command line which WorkOS client to sign in with, to anyone", async () => {
    const { status, body } = await call(request("GET", "/api/auth/cli", { token: null }));
    expect(status).toBe(200);
    expect(body).toEqual({ clientId: "client_cli_test", issuer: "https://api.workos.com" });
  });

  it("says who you are, and starts a profile on first sight", async () => {
    const { status, body } = await call(request("GET", "/api/me"));
    expect(status).toBe(200);
    expect(body).toMatchObject({ sub: "user_1", sid: "session_1", env: "test", entitlements: [] });
    expect(body["profile"]).toEqual({ createdAt: "2026-09-06T12:00:00.000Z", lastSeenAt: "2026-09-06T12:00:00.000Z" });
  });

  it("keeps the name and email the app reports, and refuses nonsense", async () => {
    const d = deps();
    const put = await call(request("PUT", "/api/me/profile", { body: { name: " Nate ", email: "n@example.com" } }), d);
    expect(put.status).toBe(200);
    expect(put.body["profile"]).toMatchObject({ name: "Nate", email: "n@example.com" });
    const me = await call(request("GET", "/api/me"), d);
    expect(me.body["profile"]).toMatchObject({ name: "Nate", email: "n@example.com" });
    expect((await call(request("PUT", "/api/me/profile", { body: { name: 7 } }), d)).status).toBe(422);
    expect((await call(request("PUT", "/api/me/profile", { body: { name: "x".repeat(400) } }), d)).status).toBe(413);
    // Accepting the terms is stamped with when, by the server, not the app.
    const terms = await call(request("PUT", "/api/me/profile", { body: { termsVersion: "2026-09-06" } }), d);
    expect(terms.body["profile"]).toMatchObject({ termsVersion: "2026-09-06", termsAcceptedAt: "2026-09-06T12:00:00.000Z", name: "Nate" });
    expect((await call(request("PUT", "/api/me/profile", { body: { termsVersion: 1 } }), d)).status).toBe(422);
  });

  it("forgets everything of yours on request, and nobody else's", async () => {
    const d = deps();
    await call(request("PUT", "/api/packs/p", { body: packBody }), d);
    await call(request("POST", "/api/sessions", { body: sessionBody }), d);
    await call(request("PUT", "/api/me/profile", { body: { name: "Nate" } }), d);
    const gone = await call(request("DELETE", "/api/me"), d);
    expect(gone.status).toBe(200);
    expect(gone.body["deleted"]).toBe(3);
    expect((await call(request("GET", "/api/sync/manifest"), d)).body).toEqual({ packs: [], sessions: [], licenses: [] });
    // Back from the dead: first sight again, with no name.
    expect((await call(request("GET", "/api/me"), d)).body["profile"]).toEqual({
      createdAt: "2026-09-06T12:00:00.000Z",
      lastSeenAt: "2026-09-06T12:00:00.000Z",
    });
  });

  it("carries where a pack came from, and which catalog entry, without reading them", async () => {
    const d = deps();
    const put = await call(request("PUT", "/api/packs/p", { body: { ...packBody, origin: "catalog", catalog: { id: "dev.runlog.kiln", version: "1.2.0" } } }), d);
    expect(put.status).toBe(200);
    const got = await call(request("GET", "/api/packs/p"), d);
    expect(got.body["pack"]).toMatchObject({ origin: "catalog", catalog: { id: "dev.runlog.kiln", version: "1.2.0" } });
    const manifest = await call(request("GET", "/api/sync/manifest"), d);
    expect((manifest.body["packs"] as Array<Record<string, unknown>>)[0]).toMatchObject({ origin: "catalog" });
    expect((await call(request("PUT", "/api/packs/q", { body: { ...packBody, origin: "stolen" } }), d)).status).toBe(422);
    expect((await call(request("PUT", "/api/packs/q", { body: { ...packBody, catalog: { id: "x" } } }), d)).status).toBe(422);
    // Without them, nothing is invented.
    await call(request("PUT", "/api/packs/plain", { body: packBody }), d);
    expect((await call(request("GET", "/api/packs/plain"), d)).body["pack"]).not.toHaveProperty("origin");
  });

  it("shows a table's people by the name they are shown as today, never the full name", async () => {
    // A seat taken before a handle was chosen kept the full name, and a
    // table read from those seats showed it to strangers. The profiles
    // are read instead, at the moment the table is asked for.
    const store = memoryStore();
    const d = deps(store);
    await call(request("PUT", "/api/me/profile", { body: { name: "Ada Lovelace" } }), d);
    await call(request("POST", "/api/sessions", { body: sessionBody }), d);
    const first = await call(request("GET", "/api/sessions/01RUN"), d);
    expect((first.body["members"] as SessionMember[]).map((m) => m.name)).toEqual(["Ada"]);
    // A handle set without going round the tables (the seat still says "Ada").
    await store.touchProfile("user_1", "2026-09-06T13:00:00.000Z", { handle: "ada-l" });
    const later = await call(request("GET", "/api/sessions/01RUN"), d);
    expect((later.body["members"] as SessionMember[]).map((m) => m.name)).toEqual(["ada-l"]);
  });

  it("runs a race: started with a code, joined by it, progress reported, ranked on the device", async () => {
    const rung: string[] = [];
    const mail = fakeMail();
    const d = deps(memoryStore(), { notify: async (id) => void rung.push(id), mailer: mail.mailer });
    const guest = { ...d, verify: async () => ({ sub: "user_2", sid: "s2" }) };
    await call(request("PUT", "/api/me/profile", { body: { name: "Ada" } }), d);
    await call(request("PUT", "/api/me/profile", { body: { name: "Ben" } }), guest);

    const made = await call(request("POST", "/api/races", { body: { id: "R1", packId: "p", packVersion: "1", packTitle: "The Pack", mode: "race", seed: "winter", sessionId: "01RUN" } }), d);
    expect(made.status).toBe(200);
    const race = made.body["race"] as Record<string, unknown>;
    expect(race).toMatchObject({ id: "R1", mode: "race", seed: "winter", ownerSub: "user_1" });
    expect(String(race["code"])).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(made.body["entries"]).toEqual([{ sub: "user_1", name: "Ada", sessionId: "01RUN", joinedAt: "2026-09-06T12:00:00.000Z" }]);
    expect((await call(request("POST", "/api/races", { body: { id: "R1", packId: "p", packVersion: "1", mode: "race", seed: "x" } }), d)).status).toBe(409);
    expect((await call(request("POST", "/api/races", { body: { id: "R2", packId: "p", packVersion: "1", mode: "race", seed: "  " } }), d)).status).toBe(422);

    // A stranger sees nothing; a code lets them in, however it was typed.
    expect((await call(request("GET", "/api/races/R1"), guest)).body).toEqual({ found: false });
    expect((await call(request("POST", "/api/races/join", { body: { code: "nope" } }), guest)).status).toBe(422);
    expect((await call(request("POST", "/api/races/join", { body: { code: "ZZZZZZ" } }), guest)).status).toBe(410);
    const joined = await call(request("POST", "/api/races/join", { body: { code: ` ${String(race["code"]).toLowerCase()} ` } }), guest);
    expect(joined.status).toBe(200);
    expect((joined.body["entries"] as unknown[]).length).toBe(2);
    expect(rung).toEqual(["R1"]);

    // Progress, and its shape.
    const progress = await call(request("PUT", "/api/races/R1/entries/me", { body: { sessionId: "02RUN", progress: { unit: 2, unitsDone: 1, status: "active", elapsedMs: 61234.7 } } }), guest);
    expect(progress.status).toBe(200);
    const ben = (progress.body["entries"] as Array<Record<string, unknown>>).find((e) => e["sub"] === "user_2");
    expect(ben).toMatchObject({ sessionId: "02RUN", progress: { unit: 2, unitsDone: 1, status: "active", elapsedMs: 61235, updatedAt: "2026-09-06T12:00:00.000Z" } });
    expect((await call(request("PUT", "/api/races/R1/entries/me", { body: { progress: { unit: -1 } } }), guest)).status).toBe(422);
    expect(rung).toEqual(["R1", "R1"]);

    // Both list it; only the owner renames, ends, or invites.
    expect(((await call(request("GET", "/api/races"), guest)).body["races"] as unknown[]).length).toBe(1);
    expect((await call(request("PATCH", "/api/races/R1", { body: { name: "Friday" } }), guest)).status).toBe(422);
    expect((await call(request("POST", "/api/races/R1/invites", { body: { email: "c@example.com" } }), guest)).status).toBe(422);
    const sent = await call(request("POST", "/api/races/R1/invites", { body: { email: "C@example.com" } }), d);
    expect(sent.status).toBe(200);
    expect(mail.sent[0]).toMatchObject({ to: "c@example.com", role: "racer" });
    expect(mail.sent[0]!.link).toContain(`?race=${String(race["code"])}`);
    const ended = await call(request("PATCH", "/api/races/R1", { body: { name: "Friday", ended: true } }), d);
    expect(ended.body["race"]).toMatchObject({ name: "Friday" });
    expect((ended.body["race"] as Record<string, unknown>)["endedAt"]).toBeTruthy();
    // Nobody joins an ended race.
    expect((await call(request("POST", "/api/races/join", { body: { code: String(race["code"]) } }), { ...d, verify: async () => ({ sub: "user_3", sid: "s3" }) })).status).toBe(410);
  });

  it("says billing is off, and gates nothing, until Stripe is configured", async () => {
    const d = deps();
    expect((await call(request("GET", "/api/me"), d)).body["gates"]).toBe(false);
    expect((await call(request("POST", "/api/billing/checkout", { body: { price: "plus-monthly" } }), d)).body).toEqual({ available: false });
    expect((await call(request("POST", "/api/billing/portal"), d)).body).toEqual({ available: false });
    expect((await call(request("POST", "/api/stripe/webhook", { token: null, body: { id: "evt_1" } }), d)).body).toEqual({ available: false });
  });

  it("makes a customer once, sends a person to Checkout and the Portal, and re-reads what they have", async () => {
    const stripe = fakeStripe();
    const billing = memoryBilling();
    const d = deps(memoryStore(), { billing, gates: true, stripe: async () => stripe, prices: { "plus-monthly": "price_m", "plus-yearly": "price_y" }, appUrl: "https://runlog.example/" });
    await call(request("PUT", "/api/me/profile", { body: { name: "Ada", email: "ada@example.com" } }), d);
    const checkout = await call(request("POST", "/api/billing/checkout", { body: { price: "plus-yearly" } }), d);
    expect(checkout.status).toBe(200);
    expect(checkout.body["url"]).toBe("https://checkout.stripe.test/price_y");
    expect((await call(request("POST", "/api/billing/checkout", { body: { price: "gold" } }), d)).status).toBe(422);
    const portal = await call(request("POST", "/api/billing/portal"), d);
    expect(portal.body["url"]).toBe("https://portal.stripe.test/");
    // One customer for the person, however many times they come.
    expect(stripe.calls.filter((c) => c.startsWith("customer"))).toEqual(["customer user_1"]);
    expect(await billing.customerOf("user_1")).toBe("cus_user_1");
    const refresh = await call(request("POST", "/api/billing/refresh"), d);
    expect(refresh.body).toEqual({ entitlements: ["plus"] });
    expect((await call(request("GET", "/api/me"), d)).body["gates"]).toBe(true);
  });

  it("takes a signed webhook once, refuses a bad signature with a 401, and ignores what it does not know", async () => {
    const stripe = fakeStripe();
    const billing = memoryBilling();
    await billing.setCustomer("user_1", "cus_user_1", "");
    const d = deps(memoryStore(), { billing, stripe: async () => stripe, webhookSecret: async () => "whsec_test" });
    const summary = { id: "evt_1", type: "entitlements.active_entitlement_summary.updated", data: { object: { customer: "cus_user_1", entitlements: { data: [{ lookup_key: "plus" }, { lookup_key: "hosted-licensing" }] } } } };
    const hook = (body: unknown, signature = "good") => request("POST", "/api/stripe/webhook", { token: null, body, headers: { "stripe-signature": signature } });
    expect((await call(hook(summary, "forged"), d)).status).toBe(401);
    const first = await call(hook(summary), d);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ applied: true, features: ["plus", "hosted-licensing"] });
    expect(billing.rows.get("user_1")).toEqual(["plus", "hosted-licensing"]);
    expect((await call(hook(summary), d)).body).toEqual({ duplicate: true });
    expect((await call(hook({ id: "evt_2", type: "customer.created", data: { object: {} } }), d)).body).toEqual({ ignored: "customer.created" });
    // A customer nobody here knows: taken, not applied.
    expect((await call(hook({ ...summary, id: "evt_3", data: { object: { ...summary.data.object, customer: "cus_stranger" } } }), d)).body).toEqual({ applied: false });
  });

  it("asks for Plus to host a table where plans are on, and for nothing where they are off", async () => {
    const billing = memoryBilling();
    const open = deps(memoryStore(), { billing, gates: false, mailer: fakeMail().mailer });
    await call(request("POST", "/api/sessions", { body: sessionBody }), open);
    expect((await call(request("POST", "/api/sessions/01RUN/invites", { body: { email: "b@example.com" } }), open)).status).toBe(200);

    const gated = deps(memoryStore(), { billing, gates: true, mailer: fakeMail().mailer });
    await call(request("POST", "/api/sessions", { body: sessionBody }), gated);
    const refused = await call(request("POST", "/api/sessions/01RUN/invites", { body: { email: "b@example.com" } }), gated);
    expect(refused.status).toBe(402);
    expect(refused.body).toMatchObject({ plan: "plus", upgrade: true });
    expect((await call(request("POST", "/api/races", { body: { id: "R1", packId: "p", packVersion: "1", mode: "race", seed: "s" } }), gated)).status).toBe(402);
    // Moderated play on one device is not hosting a table: nothing there is gated.
    expect((await call(request("POST", "/api/sessions/01RUN/events", { body: { events: [{ t: "ContestantAdded", at: "2026-09-06T12:00:00Z", id: "e9", contestant: "c1", name: "Ada" }] } }), gated)).status).toBe(200);
    // A "plus" feature flag on the session is as good as the subscription: a friend testing, a comped account.
    const flagged = { ...gated, verify: async () => ({ sub: "user_1", sid: "s1", flags: ["plus"] }) };
    expect((await call(request("POST", "/api/sessions/01RUN/invites", { body: { email: "c@example.com" } }), flagged)).status).toBe(200);
    expect((await call(request("GET", "/api/me"), flagged)).body["entitlements"]).toEqual(["plus"]);

    await billing.putEntitlements("user_1", ["plus"], "");
    expect((await call(request("POST", "/api/sessions/01RUN/invites", { body: { email: "b@example.com" } }), gated)).status).toBe(200);
    expect((await call(request("POST", "/api/races", { body: { id: "R1", packId: "p", packVersion: "1", mode: "race", seed: "s" } }), gated)).status).toBe(200);
  });

  it("makes a publisher once — an organization with its founder in it — and sets up its payouts", async () => {
    const workos = fakeWorkOS();
    const stripe = fakeStripe();
    const publishers = memoryPublishers();
    const d = deps(memoryStore(), { publishers, workos: async () => workos, stripe: async () => stripe, appUrl: "https://runlog.example/" });
    expect((await call(request("GET", "/api/publishers/me"), d)).body).toEqual({ publisher: null });
    expect((await call(request("POST", "/api/publishers", { body: { name: " " } }), d)).status).toBe(422);
    const made = await call(request("POST", "/api/publishers", { body: { name: "Kiln Press" } }), d);
    expect(made.status).toBe(200);
    expect(made.body["publisher"]).toMatchObject({ id: "org_kiln-press", name: "Kiln Press", owner: true, connectStarted: false, connectReady: false });
    expect(workos.calls).toEqual(["org Kiln Press", "member org_kiln-press user_1 admin"]);
    expect((await call(request("POST", "/api/publishers", { body: { name: "Again" } }), d)).status).toBe(409);

    // Payouts: one connected account, an onboarding link, and the state read back.
    const connect = await call(request("POST", "/api/publishers/connect"), d);
    expect(connect.body["url"]).toBe("https://connect.stripe.test/acct_org_kiln-press");
    await call(request("POST", "/api/publishers/connect"), d);
    expect(stripe.calls.filter((c) => c.startsWith("connect"))).toEqual(["connect org_kiln-press"]);
    expect((await call(request("POST", "/api/publishers/connect/refresh"), d)).body["publisher"]).toMatchObject({ connectStarted: true, connectReady: false });
    stripe.ready = true;
    expect((await call(request("POST", "/api/publishers/connect/refresh"), d)).body["publisher"]).toMatchObject({ connectReady: true });
    expect((await call(request("POST", "/api/publishers/dashboard"), d)).body["url"]).toBe("https://dashboard.stripe.test/acct_org_kiln-press");

    // The claim of a signing key names the publisher, to anyone.
    const nonce = (await call(request("POST", "/api/claims/nonce"), d)).body["nonce"] as string;
    void nonce;
    // Somebody else sees nothing of it, and cannot set it up.
    const guest = { ...d, verify: async () => ({ sub: "user_2", sid: "s2" }) };
    expect((await call(request("GET", "/api/publishers/me"), guest)).body).toEqual({ publisher: null });
    expect((await call(request("POST", "/api/publishers/connect"), guest)).body).toEqual({ publisher: null });
  });

  it("brings people into a publisher: invitations by WorkOS's mail, members by its book, admins only", async () => {
    const workos = fakeWorkOS();
    const publishers = memoryPublishers();
    const d = deps(memoryStore(), { publishers, workos: async () => workos });
    await call(request("POST", "/api/publishers", { body: { name: "Kiln Press" } }), d);
    // The founder invites; a stranger cannot.
    const sent = await call(request("POST", "/api/publishers/members/invite", { body: { email: "ben@example.com", role: "member" } }), d);
    expect(sent.status).toBe(200);
    expect(sent.body["invitation"]).toMatchObject({ email: "ben@example.com", state: "pending" });
    expect(workos.calls).toContain("invite ben@example.com org_kiln-press member by user_1");
    const listed = await call(request("GET", "/api/publishers/members"), d);
    expect(listed.body["members"]).toEqual([{ userId: "user_1", role: "admin", owner: true, me: true, email: "user_1@example.com" }]);
    expect(listed.body["invitations"]).toMatchObject([{ email: "ben@example.com", state: "pending" }]);
    // Ben accepts in WorkOS; his first visit writes him in here, as a member who cannot invite.
    workos.accept("org_kiln-press", "user_2", "member");
    const ben = { ...d, verify: async () => ({ sub: "user_2", sid: "s2" }) };
    expect((await call(request("GET", "/api/publishers/me"), ben)).body["publisher"]).toMatchObject({ id: "org_kiln-press", owner: false, role: "member" });
    expect((await call(request("POST", "/api/publishers/members/invite", { body: { email: "cy@example.com" } }), ben)).status).toBe(422);
    expect((await call(request("GET", "/api/publishers/members"), ben)).body["members"]).toHaveLength(2);
    // The founder revokes an invitation and removes a member; not themselves.
    expect((await call(request("DELETE", "/api/publishers/invitations/inv_1"), d)).body).toEqual({ revoked: true });
    expect((await call(request("DELETE", "/api/publishers/members/user_1"), d)).status).toBe(422);
    expect((await call(request("DELETE", "/api/publishers/members/user_2"), d)).body).toEqual({ removed: true });
    expect(workos.calls).toContain("remove om_user_2");
    expect((await call(request("GET", "/api/publishers/me"), ben)).body).toEqual({ publisher: null });
    // Anyone signed in may invite someone to the platform itself.
    const friend = await call(request("POST", "/api/invitations", { body: { email: "dee@example.com" } }), ben);
    expect(friend.body).toMatchObject({ sent: true, email: "dee@example.com" });
    expect(workos.calls).toContain("invite dee@example.com platform - by user_2");
    expect((await call(request("POST", "/api/invitations", { body: { email: "nope" } }), ben)).status).toBe(422);
    // The sender sees what they sent, and takes one back; nobody else can.
    expect((await call(request("GET", "/api/invitations"), ben)).body["invitations"]).toMatchObject([{ email: "dee@example.com", state: "pending" }]);
    expect((await call(request("GET", "/api/invitations"), d)).body["invitations"]).toEqual([]);
    expect((await call(request("DELETE", "/api/invitations/inv_2"), d)).body).toEqual({ found: false });
    expect((await call(request("DELETE", "/api/invitations/inv_2"), ben)).body).toEqual({ revoked: true });
    expect((await call(request("GET", "/api/invitations"), ben)).body["invitations"]).toMatchObject([{ state: "revoked" }]);
  });

  it("reads a hosted-licensing flag on the publisher's session as the subscription, for the fee", async () => {
    const stripe = fakeStripe();
    const billing = memoryBilling();
    const publishers = memoryPublishers();
    const listings = memoryListings();
    const sales = memorySales();
    let refs = 0;
    const d = deps(memoryStore(), { billing, publishers, listings, sales, stripe: async () => stripe, appUrl: "https://runlog.example/", ref: () => `REF${++refs}` });
    const flagged = { ...d, verify: async () => ({ sub: "user_1", sid: "s1", flags: ["hosted-licensing"] }) };
    await call(request("POST", "/api/publishers", { body: { name: "Kiln Press" } }), d);
    await publishers.setConnect((await publishers.publisherOf("user_1"))!.id, "", { connectAccountId: "acct_1", connectReady: true });
    const head = { title: "The Long Kiln", version: "1.0.0", category: "craft", tags: [], features: ["solo"], requires: [], players: 1, license: { id: "proprietary", redistributable: false } };
    await call(request("PUT", "/api/publishers/packs/com.example.kiln", { body: { source: "id: com.example.kiln\n", head, summary: null } }), d);
    await call(request("POST", "/api/publishers/packs/com.example.kiln/listing", { body: { amount: 1000 } }), d);
    // The publisher's session carried the flag once: /api/me remembers it.
    expect((await call(request("GET", "/api/me"), flagged)).body["entitlements"]).toEqual(["hosted-licensing"]);
    const buyer = { ...d, verify: async () => ({ sub: "user_2", sid: "s2" }) };
    await call(request("POST", "/api/listings/com.example.kiln/checkout"), buyer);
    expect(stripe.calls).toContain("sale acct_1 price_com.example.kiln_1000 fee 0 ref REF1");
  });

  it("lists a publisher's pack for anyone to see and take free, or to buy at a price", async () => {
    const stripe = fakeStripe();
    const publishers = memoryPublishers();
    const d = deps(memoryStore(), { publishers, stripe: async () => stripe });
    const head = { title: "The Long Kiln", version: "1.0.0", author: "Runlog", category: "Craft", tags: ["pottery"], features: ["solo"], requires: [{ label: "A wheel", kind: "equipment", optional: false }], players: 1, license: { id: "MIT", redistributable: true } };
    const upload = { source: "id: com.example.kiln\ntitle: The Long Kiln\n", head, summary: { kind: "summary", blocks: [] } };
    // Not a publisher yet: nothing to upload to.
    expect((await call(request("PUT", "/api/publishers/packs/com.example.kiln", { body: upload }), d)).body).toEqual({ publisher: null });
    await call(request("POST", "/api/publishers", { body: { name: "Kiln Press" } }), d);

    const put = await call(request("PUT", "/api/publishers/packs/com.example.kiln", { body: upload }), d);
    expect(put.status).toBe(200);
    expect(put.body["pack"]).toMatchObject({ packId: "com.example.kiln", status: "draft", price: null, head: { title: "The Long Kiln", category: "craft" } });
    expect((await call(request("PUT", "/api/publishers/packs/com.example.kiln", { body: { source: "x", head: { title: "T" } } }), d)).status).toBe(422);
    // Nothing listed yet: the feed is empty, and the pack is nobody's to read.
    expect((await call(request("GET", "/api/listings", { token: null }), d)).body).toEqual({ listings: [] });
    expect((await call(request("GET", "/api/listings/com.example.kiln", { token: null }), d)).body).toEqual({ found: false });

    // Listed free: on the feed with the publisher's name, its summary and its text public.
    const free = await call(request("POST", "/api/publishers/packs/com.example.kiln/listing", { body: {} }), d);
    expect(free.body["listing"]).toMatchObject({ packId: "com.example.kiln", publisherName: "Kiln Press", price: "free" });
    const feed = await call(request("GET", "/api/listings", { token: null }), d);
    expect((feed.body["listings"] as unknown[]).length).toBe(1);
    const one = await call(request("GET", "/api/listings/com.example.kiln", { token: null }), d);
    expect(one.body).toMatchObject({ found: true, summary: { kind: "summary" } });
    const file = await route(request("GET", "/api/listings/com.example.kiln/file", { token: null }), d);
    expect(typeof file === "string" ? "" : file.body).toContain("title: The Long Kiln");
    expect(typeof file === "string" ? {} : file.headers).toMatchObject({ "cache-control": "public, max-age=60" });

    // For sale: needs payouts; then a product and price on the publisher's account, and the text is no longer given away.
    expect((await call(request("POST", "/api/publishers/packs/com.example.kiln/listing", { body: { amount: 300 } }), d)).status).toBe(422);
    await publishers.setConnect((await publishers.publisherOf("user_1"))!.id, "", { connectAccountId: "acct_1", connectReady: true });
    expect((await call(request("POST", "/api/publishers/packs/com.example.kiln/listing", { body: { amount: 5 } }), d)).status).toBe(422);
    const priced = await call(request("POST", "/api/publishers/packs/com.example.kiln/listing", { body: { amount: 300, currency: "USD" } }), d);
    expect(priced.body["listing"]).toMatchObject({ price: { amount: 300, currency: "usd" } });
    expect(stripe.calls).toContain("listing acct_1 com.example.kiln 300 usd");
    expect((await call(request("GET", "/api/listings/com.example.kiln/file", { token: null }), d)).status).toBe(410);
    // The same price again makes nothing new; a new price retires the old one and reuses the product.
    await call(request("POST", "/api/publishers/packs/com.example.kiln/listing", { body: { amount: 300 } }), d);
    expect(stripe.calls.filter((c) => c.startsWith("listing"))).toHaveLength(1);
    await call(request("POST", "/api/publishers/packs/com.example.kiln/listing", { body: { amount: 500 } }), d);
    expect(stripe.calls).toContain("retire price_com.example.kiln_300");
    expect(stripe.calls).toContain("listing acct_1 com.example.kiln 500 usd again");

    // A new upload refreshes the card; unlisting takes it off the feed and keeps the pack.
    await call(request("PUT", "/api/publishers/packs/com.example.kiln", { body: { ...upload, head: { ...head, version: "1.1.0" } } }), d);
    expect(((await call(request("GET", "/api/listings", { token: null }), d)).body["listings"] as Array<{ head: { version: string } }>)[0]!.head.version).toBe("1.1.0");
    await call(request("DELETE", "/api/publishers/packs/com.example.kiln/listing"), d);
    expect((await call(request("GET", "/api/listings", { token: null }), d)).body).toEqual({ listings: [] });
    expect(((await call(request("GET", "/api/publishers/packs"), d)).body["packs"] as Array<{ status: string }>)[0]!.status).toBe("draft");
    // Gone for good.
    await call(request("DELETE", "/api/publishers/packs/com.example.kiln"), d);
    expect((await call(request("GET", "/api/publishers/packs"), d)).body).toEqual({ packs: [] });
  });

  it("sells a pack: a Checkout on the publisher's account, a sealed copy for the buyer alone, a receipt, and a ledger", async () => {
    const stripe = fakeStripe();
    const publishers = memoryPublishers();
    const listings = memoryListings();
    const sales = memorySales();
    const mail = fakeMail();
    let refs = 0;
    const d = deps(memoryStore(), { publishers, listings, sales, stripe: async () => stripe, mailer: mail.mailer, appUrl: "https://runlog.example/", connectWebhookSecret: async () => "whsec_connect", ref: () => `REF${++refs}` });
    const buyer = { ...d, verify: async () => ({ sub: "user_2", sid: "s2" }) };
    // The publisher, set up, with a priced pack.
    await call(request("PUT", "/api/me/profile", { body: { name: "Kiln Press", email: "press@example.com" } }), d);
    await call(request("POST", "/api/publishers", { body: { name: "Kiln Press" } }), d);
    await publishers.setConnect((await publishers.publisherOf("user_1"))!.id, "", { connectAccountId: "acct_1", connectReady: true });
    const source = "id: com.example.kiln\ntitle: The Long Kiln\nversion: \"1.0.0\"\n";
    const head = { title: "The Long Kiln", version: "1.0.0", category: "craft", tags: [], features: ["solo"], requires: [], players: 1, license: { id: "proprietary", redistributable: false } };
    await call(request("PUT", "/api/publishers/packs/com.example.kiln", { body: { source, head, summary: null } }), d);
    await call(request("POST", "/api/publishers/packs/com.example.kiln/listing", { body: { amount: 1000 } }), d);

    // The buyer, signed in with an address, is sent to Checkout; the fee is 5% since the publisher does not subscribe.
    await call(request("PUT", "/api/me/profile", { body: { name: "Ben", email: "Ben@example.com" } }), buyer);
    const checkout = await call(request("POST", "/api/listings/com.example.kiln/checkout"), buyer);
    expect(checkout.status).toBe(200);
    expect(checkout.body).toEqual({ url: "https://checkout.stripe.test/sale/REF1", ref: "REF1" });
    expect(stripe.calls).toContain("sale acct_1 price_com.example.kiln_1000 fee 50 ref REF1");
    expect((await call(request("GET", "/api/purchases/REF1"), buyer)).body).toMatchObject({ found: true, purchase: { status: "pending" } });
    expect((await call(request("GET", "/api/purchases/REF1"), d)).body).toEqual({ found: false });
    // A free pack has no checkout; an unknown one neither.
    expect((await call(request("POST", "/api/listings/nope/checkout"), buyer)).body).toEqual({ found: false });

    // Stripe says it was paid: sealed, filed, mailed.
    const paid = { id: "evt_c1", type: "checkout.session.completed", account: "acct_1", data: { object: { id: "cs_REF1", metadata: { sale_ref: "REF1" }, customer_details: { email: "ben@example.com" } } } };
    const hook = (body: unknown, signature = "good", id?: string) => request("POST", "/api/stripe/connect-webhook", { token: null, body: id ? { ...(body as object), id } : body, headers: { "stripe-signature": signature } });
    expect((await call(hook(paid, "forged"), d)).status).toBe(401);
    expect((await call(hook(paid), d)).body).toEqual({ applied: true, ref: "REF1" });
    expect((await call(hook(paid), d)).body).toEqual({ duplicate: true });
    expect((await call(hook(paid, "good", "evt_c2"), d)).body).toEqual({ applied: false, already: "fulfilled" });
    expect(mail.receipts).toHaveLength(1);
    expect(mail.receipts[0]).toMatchObject({ to: "ben@example.com", pack: "The Long Kiln" });
    const key = mail.receipts[0]!.key;
    expect(key).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
    const token = new URL(mail.receipts[0]!.link).searchParams.get("t")!;

    // The buyer's account holds the key; the purchase and the file are theirs.
    expect((await call(request("GET", "/api/licenses/com.example.kiln"), buyer)).body).toMatchObject({ found: true, license: { key, ref: "REF1" } });
    const mine = await call(request("GET", "/api/me/purchases"), buyer);
    expect(mine.body["purchases"]).toMatchObject([{ ref: "REF1", status: "fulfilled", key }]);
    // Buying it again is refused: the copy is already theirs.
    const again = await call(request("POST", "/api/listings/com.example.kiln/checkout"), buyer);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ owned: true });
    const file = await route(request("GET", "/api/purchases/REF1/file"), buyer);
    expect(typeof file !== "string" && file.isBase64Encoded).toBe(true);
    const bytes = Buffer.from(typeof file === "string" ? "" : (file.body ?? ""), "base64");
    expect(readHeader(bytes)).toMatchObject({ ref: "REF1", title: "The Long Kiln" });
    expect(await open(bytes, key)).toMatchObject({ id: "com.example.kiln" });
    // The publisher releases a new version: the same key opens the copy as it now stands.
    const newer = ["id: com.example.kiln", "title: The Long Kiln", 'version: "1.1.0"', ""].join("\n");
    await call(request("PUT", "/api/publishers/packs/com.example.kiln", { body: { source: newer, head: { ...head, version: "1.1.0" }, summary: null } }), d);
    const fresh = await route(request("GET", "/api/purchases/REF1/file"), buyer);
    const freshBytes = Buffer.from(typeof fresh === "string" ? "" : (fresh.body ?? ""), "base64");
    expect(await open(freshBytes, key)).toMatchObject({ id: "com.example.kiln", version: "1.1.0" });
    expect(await open(bytes, "WRONG-WRONG-WRONG-WRONG")).toBeNull();
    // The mail's link works with no account at all; a wrong token reads nothing.
    const byToken = await route(request("GET", `/api/purchases/REF1/file?t=${encodeURIComponent(token)}`, { token: null }), d);
    expect(typeof byToken !== "string" && byToken.isBase64Encoded).toBe(true);
    expect((await call(request("GET", "/api/purchases/REF1/file?t=nope", { token: null }), d)).body).toEqual({ found: false });

    // The ledger: the sale, a reissue that mails the same key again, a revocation that closes the file.
    const ledger = await call(request("GET", "/api/publishers/sales"), d);
    expect(ledger.body["sales"]).toMatchObject([{ ref: "REF1", buyerEmail: "ben@example.com", amount: 1000, fee: 50, status: "fulfilled", key }]);
    expect((await call(request("GET", "/api/publishers/sales"), buyer)).body).toEqual({ publisher: null });
    const reissued = await call(request("POST", "/api/publishers/sales/REF1/reissue"), d);
    expect(reissued.status).toBe(200);
    expect(mail.receipts).toHaveLength(2);
    expect(mail.receipts[1]!.key).toBe(key);
    expect((await call(request("GET", `/api/purchases/REF1/file?t=${encodeURIComponent(token)}`, { token: null }), d)).body).toEqual({ found: false });
    await call(request("POST", "/api/publishers/sales/REF1/revoke"), d);
    expect((await call(request("GET", "/api/purchases/REF1/file"), buyer)).status).toBe(410);
  });

  it("takes no fee from a publisher who subscribes to hosted licensing", async () => {
    const stripe = fakeStripe();
    const publishers = memoryPublishers();
    const billing = memoryBilling();
    const d = deps(memoryStore(), { publishers, billing, stripe: async () => stripe, ref: () => "REF9" });
    await call(request("POST", "/api/publishers", { body: { name: "P" } }), d);
    await publishers.setConnect((await publishers.publisherOf("user_1"))!.id, "", { connectAccountId: "acct_1", connectReady: true });
    await billing.putEntitlements("user_1", ["hosted-licensing"], "");
    const head = { title: "T", version: "1", category: "other", tags: [], features: [], requires: [], players: 1, license: { id: "MIT", redistributable: true } };
    await call(request("PUT", "/api/publishers/packs/p", { body: { source: "id: p", head, summary: null } }), d);
    await call(request("POST", "/api/publishers/packs/p/listing", { body: { amount: 1000 } }), d);
    await call(request("POST", "/api/listings/p/checkout"), { ...d, verify: async () => ({ sub: "user_2", sid: "s2" }) });
    expect(stripe.calls).toContain("sale acct_1 price_p_1000 fee 0 ref REF9");
  });

  it("passes Stripe's refusal of a connected account on as a 422, in its words", async () => {
    const stripe = fakeStripe();
    stripe.createConnectedAccount = async () => {
      throw Object.assign(new Error("You can only create new accounts if you've signed up for Connect"), { type: "StripeInvalidRequestError" });
    };
    const d = deps(memoryStore(), { stripe: async () => stripe });
    await call(request("POST", "/api/publishers", { body: { name: "P" } }), d);
    const out = await call(request("POST", "/api/publishers/connect"), d);
    expect(out.status).toBe(422);
    expect(String(out.body["error"])).toContain("signed up for Connect");
  });

  it("hears from Stripe when a connected account is ready", async () => {
    const stripe = fakeStripe();
    const publishers = memoryPublishers();
    await publishers.createPublisher({ id: "org_1", name: "P", ownerSub: "user_1" }, "");
    await publishers.setConnect("org_1", "", { connectAccountId: "acct_1" });
    const d = deps(memoryStore(), { publishers, stripe: async () => stripe, webhookSecret: async () => "whsec_test" });
    const hook = (object: Record<string, unknown>, id = "evt_a") => request("POST", "/api/stripe/webhook", { token: null, body: { id, type: "account.updated", data: { object } }, headers: { "stripe-signature": "good" } });
    expect((await call(hook({ id: "acct_1", charges_enabled: true, details_submitted: true }), d)).body).toEqual({ applied: true });
    expect((await publishers.getPublisher("org_1"))?.connectReady).toBe(true);
    expect((await call(hook({ id: "acct_nobody", charges_enabled: true, details_submitted: true }, "evt_b"), d)).body).toEqual({ applied: false });
  });

  it("shares a run by link: a stranger reads the state, the pack only where its license allows, and nothing once revoked", async () => {
    const rung: string[] = [];
    const listings = memoryListings();
    const d = deps(memoryStore(), { listings, notify: async (id) => void rung.push(id), appUrl: "https://runlog.example/", token: () => "livetok" });
    await call(request("POST", "/api/sessions", { body: sessionBody }), d);
    // Only the owner shares; the link carries the token, the session row its hash.
    expect((await call(request("POST", "/api/sessions/01RUN/public"), { ...d, verify: async () => ({ sub: "user_2", sid: "s2" }) })).body).toEqual({ found: false });
    const shared = await call(request("POST", "/api/sessions/01RUN/public"), d);
    expect(shared.body).toEqual({ shared: true, token: "livetok", link: "https://runlog.example/r/01RUN?t=livetok" });
    // The short link is a page a chat can preview, which sends a browser on to the app; a wrong token gets a page that says nothing.
    const page = await route(request("GET", "/r/01RUN?t=livetok", { token: null }), d);
    const html = typeof page === "string" ? page : (page.body ?? "");
    expect(typeof page !== "string" && page.headers?.["content-type"]).toContain("text/html");
    expect(html).toContain('http-equiv="refresh" content="0; url=https://runlog.example/#run/01RUN?t=livetok"');
    expect(html).toContain("og:title");
    expect(html).not.toContain("<script");
    const closed = typeof (await route(request("GET", "/r/01RUN?t=nope", { token: null }), d)) === "string" ? "" : ((await route(request("GET", "/r/01RUN?t=nope", { token: null }), d)) as { body?: string }).body ?? "";
    expect(closed).toContain("Not open");
    expect(closed).not.toContain("refresh");
    const seen = await call(request("GET", "/api/sessions/01RUN"), d);
    expect(seen.body["session"]).toMatchObject({ shared: true });
    expect(JSON.stringify(seen.body)).not.toContain("publicTokenHash");
    // A stranger with the wrong token sees nothing; with the right one, the state as a snapshot, since the owner's pack is not shareable.
    expect((await call(request("GET", "/api/public/runs/01RUN?t=nope", { token: null }), d)).body).toEqual({ found: false });
    const before = await call(request("GET", "/api/public/runs/01RUN?t=livetok", { token: null }), d);
    expect(before.body).toMatchObject({ found: true, access: "snapshot", run: { id: "01RUN", packId: sessionBody.packId }, snapshot: null });
    expect(JSON.stringify(before.body)).not.toContain("source");
    // The owner's device writes the snapshot after a move; watchers are rung.
    const snapshot = { unit: 2, score: { label: "Days", text: "2 days", value: 2, better: "higher" }, latest: { where: "Day 2", text: "A dry wind." }, log: ["a move"] };
    expect((await call(request("PUT", "/api/sessions/01RUN/snapshot", { body: { snapshot } }), d)).body).toEqual({ kept: true });
    expect(rung).toContain("01RUN");
    const after = await call(request("GET", "/api/public/runs/01RUN?t=livetok", { token: null }), d);
    expect(after.body["snapshot"]).toMatchObject({ snapshot: { unit: 2 } });
    // A stream plugin reads the same as numbers, from anywhere, without the log. Everything else the
    // snapshot carries passes through untouched: docs/stream-api.md promises a chat bot `score.text`
    // and `latest.text` without reducing anything, so the route must not pick fields.
    const metrics = await route(request("GET", "/api/public/runs/01RUN/metrics?t=livetok", { token: null }), d);
    expect(typeof metrics !== "string" && metrics.headers).toMatchObject({ "access-control-allow-origin": "*", "cache-control": "no-store" });
    const numbers = JSON.parse(typeof metrics === "string" ? "{}" : (metrics.body ?? "{}")) as Record<string, unknown>;
    expect(numbers).toMatchObject({ found: true, ready: true, unit: 2, score: snapshot.score, latest: snapshot.latest, run: { id: "01RUN", packId: sessionBody.packId } });
    expect(numbers).not.toHaveProperty("log");
    expect((await call(request("GET", "/api/public/runs/01RUN/metrics?t=nope", { token: null }), d)).body).toEqual({ found: false });
    // A pack whose license lets its text travel is handed over whole, with the log.
    await call(request("PUT", `/api/packs/${sessionBody.packId}`, { body: { title: "Kiln", version: "1", format: "yaml", filename: "k.yaml", importedAt: "2026-01-01", updatedAt: "2026-01-01", hash: "h", source: "id: kiln\n", shareable: true } }), d);
    const full = await call(request("GET", "/api/public/runs/01RUN?t=livetok", { token: null }), d);
    expect(full.body).toMatchObject({ found: true, access: "full", pack: { format: "yaml", source: "id: kiln\n" } });
    expect(Array.isArray(full.body["events"])).toBe(true);
    // A watcher signed in takes a seat on their own account: the run follows them like an invited one.
    const guest = { ...d, verify: async () => ({ sub: "user_9", sid: "s9" }) };
    expect((await call(request("POST", "/api/public/runs/01RUN/watch?t=nope"), guest)).body).toEqual({ found: false });
    expect((await call(request("POST", "/api/public/runs/01RUN/watch?t=livetok"), guest)).body).toEqual({ sessionId: "01RUN", role: "viewer" });
    expect((await call(request("GET", "/api/sync/manifest"), guest)).body["sessions"]).toEqual(expect.arrayContaining([expect.objectContaining({ id: "01RUN", role: "viewer" })]));
    // The owner asking keeps their seat.
    expect((await call(request("POST", "/api/public/runs/01RUN/watch?t=livetok"), d)).body).toEqual({ sessionId: "01RUN", role: "owner" });
    // Anyone with the link reacts, with one of a few emoji; the table and the watchers see it.
    expect((await call(request("POST", "/api/public/runs/01RUN/reactions?t=livetok", { token: null, body: { emoji: "🎉" } }), d)).status).toBe(422);
    const reacted = await call(request("POST", "/api/public/runs/01RUN/reactions?t=livetok", { token: null, body: { emoji: "🔥", name: "Mira" } }), d);
    expect(reacted.body["reactions"]).toEqual([{ emoji: "🔥", name: "Mira", at: expect.any(String) as unknown as string }]);
    expect((await call(request("GET", "/api/public/runs/01RUN?t=livetok", { token: null }), d)).body["reactions"]).toHaveLength(1);
    expect((await call(request("GET", "/api/sessions/01RUN/reactions"), d)).body["reactions"]).toHaveLength(1);
    // The table reacts too, under the name it is shown as.
    const named = await call(request("PUT", "/api/me/profile", { body: { name: "Nate Ferrell", handle: "kilnkeeper" } }), d);
    // Choosing a name is remembered as a choice, and the seats this person holds show it from now on.
    expect((named.body["profile"] as Profile).handleSetAt).toEqual(expect.any(String));
    expect((await call(request("GET", "/api/sessions/01RUN"), d)).body["members"]).toEqual(expect.arrayContaining([expect.objectContaining({ role: "owner", name: "kilnkeeper" })]));
    expect((await call(request("PUT", "/api/me/profile", { body: { handle: "no@address.example" } }), d)).status).toBe(422);
    const fromTable = await call(request("POST", "/api/sessions/01RUN/reactions", { body: { emoji: "👏" } }), d);
    expect((fromTable.body["reactions"] as Array<{ name?: string }>).at(-1)).toMatchObject({ name: "kilnkeeper" });
    expect((await call(request("POST", "/api/sessions/01RUN/reactions", { body: { emoji: "🎉" } }), d)).status).toBe(422);
    // Revoked: the link is dead.
    expect((await call(request("DELETE", "/api/sessions/01RUN/public"), d)).body).toEqual({ shared: false });
    expect((await call(request("GET", "/api/public/runs/01RUN?t=livetok", { token: null }), d)).body).toEqual({ found: false });
  });

  it("rings the doorbell after a move, a rename, and a seat taken", async () => {
    const rung: Array<[string, number]> = [];
    const d = deps(memoryStore(), { notify: async (id, seq) => void rung.push([id, seq]) });
    await call(request("POST", "/api/sessions", { body: sessionBody }), d);
    await call(request("POST", "/api/sessions/01RUN/events", { body: { events: [{ t: "UnitEntered", at: "2026-09-06T12:00:00Z", id: "e2" }] } }), d);
    await call(request("PATCH", "/api/sessions/01RUN", { body: { name: "Tuesday" } }), d);
    expect(rung).toEqual([
      ["01RUN", 3],
      ["01RUN", 3],
    ]);
  });

  it("answers an unknown route with 410, which CloudFront leaves alone", async () => {
    expect((await call(request("GET", "/api/nope"))).status).toBe(410);
    expect((await call(request("POST", "/api/me"))).status).toBe(410);
  });
});

describe("a session's sort keys", () => {
  it("put META and the members under one prefix nothing else shares, and events in a range of their own", () => {
    // The store reads a session's shape with begins_with("M") and its log
    // with a BETWEEN on EVENT# keys. This is the assumption those rely on,
    // written down where a change to a key would break it loudly.
    const keys = ["EVENT#0000000001", "EVENT#0000000030", "INVITE#tok", "MEMBER#user_1", "META", "SEEN#e1"];
    expect(keys.filter((k) => k.startsWith("M"))).toEqual(["MEMBER#user_1", "META"]);
    const from = "EVENT#0000000001";
    const to = "EVENT#9999999999";
    expect(keys.filter((k) => k >= from && k <= to)).toEqual(["EVENT#0000000001", "EVENT#0000000030"]);
    // And the bug this guards against: neither shape row sorts before EVENT#.
    expect(keys.filter((k) => k < "EVENT#")).toEqual([]);
  });
});

describe("sessions", () => {
  it("starts one, lists it, and reads it back with everything numbered", async () => {
    const d = deps();
    const made = await call(request("POST", "/api/sessions", { body: sessionBody }), d);
    expect(made.status).toBe(200);
    expect((made.body["events"] as StoredEvent[]).map((e) => [e.id, e.seq, e.author])).toEqual([["e0", 1, "user_1"], ["e1", 2, "user_1"]]);
    const listed = await call(request("GET", "/api/sessions"), d);
    expect(listed.body["sessions"]).toMatchObject([{ id: "01RUN", role: "owner", seq: 2, packId: "p" }]);
    const got = await call(request("GET", "/api/sessions/01RUN"), d);
    expect(got.body["found"]).toBe(true);
    expect((got.body["events"] as StoredEvent[]).length).toBe(2);
    expect(got.body["members"]).toMatchObject([{ sub: "user_1", role: "owner" }]);
  });

  it("appends in order, hands back only what is new, and never keeps an event twice", async () => {
    const d = deps();
    await call(request("POST", "/api/sessions", { body: sessionBody }), d);
    const move = [{ t: "Rolled", at: "2026-09-06T00:02:00Z", id: "e2", purpose: "x", dice: "d6", total: 4, values: [4], source: "rng" }];
    const first = await call(request("POST", "/api/sessions/01RUN/events", { body: { events: move } }), d);
    expect(first.body).toMatchObject({ seq: 3, appended: [{ id: "e2", seq: 3 }] });
    // The reply was lost; the client sends the same move again.
    const again = await call(request("POST", "/api/sessions/01RUN/events", { body: { events: move } }), d);
    expect(again.body).toMatchObject({ seq: 3, appended: [] });
    const after = await call(request("GET", "/api/sessions/01RUN?after=2"), d);
    expect((after.body["events"] as StoredEvent[]).map((e) => e.seq)).toEqual([3]);
  });

  it("refuses a session that already exists, and a log that does not start properly", async () => {
    const d = deps();
    await call(request("POST", "/api/sessions", { body: sessionBody }), d);
    expect((await call(request("POST", "/api/sessions", { body: sessionBody }), d)).status).toBe(409);
    expect((await call(request("POST", "/api/sessions", { body: { ...sessionBody, id: "02", events: [entered] } }), d)).status).toBe(422);
    expect((await call(request("POST", "/api/sessions", { body: { ...sessionBody, id: "02", events: [{ ...started, id: undefined }] } }), d)).status).toBe(422);
  });

  it("shows a stranger nothing, and the same nothing as a session that never was", async () => {
    const d = deps();
    await call(request("POST", "/api/sessions", { body: sessionBody }), d);
    const stranger: Deps = { ...d, verify: async () => ({ sub: "user_2", sid: "s2" }) };
    expect((await call(request("GET", "/api/sessions/01RUN"), stranger)).body).toEqual({ found: false });
    expect((await call(request("GET", "/api/sessions/nothing"), d)).body).toEqual({ found: false });
    expect((await call(request("POST", "/api/sessions/01RUN/events", { body: { events: [entered] } }), stranger)).body).toEqual({ found: false });
  });

  it("renames and ends, and the owner's delete reads back as gone", async () => {
    const d = deps();
    await call(request("POST", "/api/sessions", { body: sessionBody }), d);
    const renamed = await call(request("PATCH", "/api/sessions/01RUN", { body: { name: "Tuesday" } }), d);
    expect(renamed.body["session"]).toMatchObject({ name: "Tuesday" });
    const ended = await call(request("PATCH", "/api/sessions/01RUN", { body: { ended: true } }), d);
    expect((ended.body["session"] as SessionMeta).endedAt).toBeDefined();
    expect((await call(request("DELETE", "/api/sessions/01RUN"), d)).body).toEqual({ deletedAt: "2026-09-06T12:00:00.000Z" });
    expect((await call(request("GET", "/api/sessions/01RUN"), d)).status).toBe(410);
  });

  it("invites by email, shows the link what it is for, and lets the invitee in", async () => {
    const mail = fakeMail();
    const d = deps(memoryStore(), { mailer: mail.mailer });
    await call(request("PUT", "/api/me/profile", { body: { name: "Nate" } }), d);
    await call(request("POST", "/api/sessions", { body: { ...sessionBody, name: "Tuesday" } }), d);

    const sent = await call(request("POST", "/api/sessions/01RUN/invites", { body: { email: "Friend@Example.com", role: "player" } }), d);
    expect(sent.status).toBe(200);
    expect(sent.body["link"]).toBe("https://runlog.test/?join=tok1");
    expect(mail.sent).toEqual([{ to: "friend@example.com", link: "https://runlog.test/?join=tok1", role: "player", pack: "The Pack" }]);

    // Before signing in: what the link is for, and the address masked.
    const peek = await call(request("GET", "/api/invites/tok1", { token: null }), d);
    expect(peek.status).toBe(200);
    expect(peek.body).toEqual({
      found: true,
      invite: { role: "player", packId: "p", packTitle: "The Pack", session: "Tuesday", inviter: "Nate", accepted: false, sentTo: "f*****@example.com", forYou: null, alreadyIn: false },
    });
    expect(JSON.stringify(peek.body)).not.toContain("friend@example.com");

    // The owner opens their own link: told it is not theirs, and it is not spent.
    const ownerPeek = await call(request("GET", "/api/invites/tok1"), d);
    expect(ownerPeek.body["invite"]).toMatchObject({ forYou: false, alreadyIn: true });
    expect((await call(request("POST", "/api/invites/tok1/accept"), d)).body).toEqual({ sessionId: "01RUN", alreadyIn: true });
    expect((await call(request("GET", "/api/invites/tok1", { token: null }), d)).body["invite"]).toMatchObject({ accepted: false });

    // A third person on the wrong address is refused, and it is still not spent.
    const stranger: Deps = { ...d, verify: async () => ({ sub: "user_3", sid: "s3" }) };
    await call(request("PUT", "/api/me/profile", { body: { email: "other@example.com" } }), stranger);
    expect((await call(request("POST", "/api/invites/tok1/accept"), stranger)).status).toBe(422);

    // A fresh account that never opened its profile carries its address with the accept; a wrong one is still refused.
    const fresh = { ...d, verify: async () => ({ sub: "user_4", sid: "s4" }) };
    expect((await call(request("POST", "/api/invites/tok1/accept", { body: { email: "someone@example.com" } }), fresh)).status).toBe(422);
    expect((await call(request("GET", "/api/invites/tok1", { token: "guest" }), { ...d, verify: async () => ({ sub: "user_2", sid: "s2" }) })).body["invite"]).toMatchObject({ forYou: false });
    // The invitee, signed in as the address it went to, accepts and can play.
    await call(request("PUT", "/api/me/profile", { body: { email: "Friend@example.com" } }), { ...d, verify: async () => ({ sub: "user_2", sid: "s2" }) });
    expect((await call(request("GET", "/api/invites/tok1", { token: "guest" }), d)).body["invite"]).toMatchObject({ forYou: true, alreadyIn: false });
    const joined = await call(request("POST", "/api/invites/tok1/accept", { token: "guest" }), d);
    expect(joined.body).toEqual({ sessionId: "01RUN" });
    const theirs = await call(request("GET", "/api/sessions/01RUN"), { ...d, verify: async () => ({ sub: "user_2", sid: "s2" }) });
    expect(theirs.body["found"]).toBe(true);
    expect(theirs.body["members"]).toMatchObject([{ sub: "user_1", role: "owner" }, { sub: "user_2", role: "player" }]);

    // The owner's list says it was taken; the people list on both sides knows the other.
    const list = await call(request("GET", "/api/sessions/01RUN/invites"), d);
    expect(list.body["invites"]).toMatchObject([{ email: "friend@example.com", accepted: true }]);
    expect((await call(request("GET", "/api/people"), d)).body["people"]).toMatchObject([{ sub: "user_2" }]);
    expect((await call(request("GET", "/api/people", { token: "guest" }), d)).body["people"]).toMatchObject([{ sub: "user_1", name: "Nate" }]);
  });

  it("counts a screen, by version and country, and never anyone who asked not to be", async () => {
    const counted: Array<{ screen: string; version: string; country: string }> = [];
    const d = deps(memoryStore(), { count: (v) => counted.push(v) });
    const view = { t: "view", screen: "play", v: "0.1.0" };
    expect((await call(request("POST", "/api/beacon", { body: view, token: null, headers: { "cloudfront-viewer-country": "de" } }), d)).body).toEqual({ counted: true });
    expect((await call(request("POST", "/api/beacon", { body: { ...view, v: "not a version" }, token: null }), d)).body).toEqual({ counted: true });
    expect(counted).toEqual([
      { screen: "play", version: "0.1.0", country: "DE" },
      { screen: "play", version: "unknown", country: "ZZ" },
    ]);
    // The browser's wish, and a screen that is not one of the app's.
    expect((await call(request("POST", "/api/beacon", { body: view, token: null, headers: { "sec-gpc": "1" } }), d)).body).toEqual({ counted: false });
    expect((await call(request("POST", "/api/beacon", { body: { ...view, screen: "run/01ABC" }, token: null }), d)).status).toBe(422);
    expect(counted).toHaveLength(2);
  });

  it("hands the account everything it holds as one file", async () => {
    const d = deps(memoryStore(), { mailer: fakeMail().mailer });
    await call(request("PUT", "/api/me/profile", { body: { name: "Nate", email: "nate@example.com" } }), d);
    await call(request("POST", "/api/sessions", { body: { ...sessionBody, name: "Tuesday" } }), d);
    await call(request("POST", "/api/sessions/01RUN/invites", { body: { email: "friend@example.com", role: "player" } }), d);
    await call(request("PUT", "/api/packs/p", { body: packBody }), d);

    const made = await call(request("POST", "/api/me/export"), d);
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({ url: "https://export.test/user_1" });
    expect(made.body["bytes"]).toBeGreaterThan(100);
    const file = JSON.parse((d.store as unknown as { exports: Map<string, string> }).exports.get("user_1") ?? "{}") as Record<string, unknown>;
    expect(file["account"]).toMatchObject({ id: "user_1", profile: { name: "Nate", email: "nate@example.com" } });
    expect(file["sessions"]).toMatchObject([{ id: "01RUN", role: "owner", name: "Tuesday", invites: [{ email: "friend@example.com" }] }]);
    expect((file["sessions"] as Array<{ events: unknown[] }>)[0]!.events.length).toBeGreaterThan(0);
    expect(file["packs"]).toMatchObject([{ id: "p", source: packBody.source }]);

    // A command-line key does not get to walk off with the lot.
    expect((await call(request("POST", "/api/me/export"), { ...d, verify: async () => ({ sub: "user_1", sid: "key:k1" }) })).status).toBe(422);
  });

  it("lists the invitations waiting for an address in the app, and lets one be declined", async () => {
    const d = deps(memoryStore(), { mailer: fakeMail().mailer });
    await call(request("PUT", "/api/me/profile", { body: { name: "Nate" } }), d);
    await call(request("POST", "/api/sessions", { body: { ...sessionBody, name: "Tuesday" } }), d);
    await call(request("POST", "/api/sessions/01RUN/invites", { body: { email: "Friend@Example.com", role: "viewer" } }), d);

    // Nothing until the account says what its address is.
    const friend: Deps = { ...d, verify: async () => ({ sub: "user_2", sid: "s2" }) };
    expect((await call(request("GET", "/api/me/invites"), friend)).body).toEqual({ invites: [] });
    await call(request("PUT", "/api/me/profile", { body: { email: "friend@example.com" } }), friend);
    const mine = await call(request("GET", "/api/me/invites"), friend);
    expect(mine.body["invites"]).toMatchObject([{ token: "tok1", role: "viewer", packId: "p", packTitle: "The Pack", session: "Tuesday", inviter: "Nate", alreadyIn: false }]);

    // Somebody else's address sees nothing of it, and cannot decline it.
    const stranger: Deps = { ...d, verify: async () => ({ sub: "user_3", sid: "s3" }) };
    await call(request("PUT", "/api/me/profile", { body: { email: "other@example.com" } }), stranger);
    expect((await call(request("GET", "/api/me/invites"), stranger)).body).toEqual({ invites: [] });
    expect((await call(request("DELETE", "/api/me/invites/tok1"), stranger)).status).toBe(422);

    // Declined: gone from the invitee's list and the owner's, and the link is dead.
    expect((await call(request("DELETE", "/api/me/invites/tok1"), friend)).body).toEqual({ declined: true });
    expect((await call(request("GET", "/api/me/invites"), friend)).body).toEqual({ invites: [] });
    expect((await call(request("GET", "/api/sessions/01RUN/invites"), d)).body).toEqual({ invites: [] });
    expect((await call(request("GET", "/api/invites/tok1", { token: null }), d)).body).toEqual({ found: false });

    // Accepted, it leaves the list as well.
    await call(request("POST", "/api/sessions/01RUN/invites", { body: { email: "friend@example.com", role: "player" } }), d);
    expect((await call(request("GET", "/api/me/invites"), friend)).body["invites"]).toHaveLength(1);
    expect((await call(request("POST", "/api/invites/tok2/accept"), friend)).body).toEqual({ sessionId: "01RUN" });
    expect((await call(request("GET", "/api/me/invites"), friend)).body).toEqual({ invites: [] });
  });

  it("refuses a bad address, a non-owner, and the twenty-first invitation in an hour", async () => {
    const d = deps();
    await call(request("POST", "/api/sessions", { body: sessionBody }), d);
    expect((await call(request("POST", "/api/sessions/01RUN/invites", { body: { email: "nope" } }), d)).status).toBe(422);
    for (let i = 0; i < 20; i++) {
      expect((await call(request("POST", "/api/sessions/01RUN/invites", { body: { email: `p${i}@example.com` } }), d)).status).toBe(200);
    }
    expect((await call(request("POST", "/api/sessions/01RUN/invites", { body: { email: "p21@example.com" } }), d)).status).toBe(429);
    // A stranger, even with a valid token, is not a member and sees nothing.
    expect((await call(request("POST", "/api/sessions/01RUN/invites", { body: { email: "x@example.com" }, token: "guest" }), d)).body).toEqual({ found: false });
  });

  it("keeps a viewer watching, lets the owner remove a member, and withdraws an invitation", async () => {
    const d = deps();
    await call(request("POST", "/api/sessions", { body: sessionBody }), d);
    await call(request("POST", "/api/sessions/01RUN/invites", { body: { email: "w@example.com", role: "viewer" } }), d);
    await call(request("PUT", "/api/me/profile", { body: { email: "w@example.com" } }), { ...d, verify: async () => ({ sub: "user_2", sid: "s2" }) });
    await call(request("POST", "/api/invites/tok1/accept", { token: "guest" }), d);
    const asGuest = { ...d, verify: async () => ({ sub: "user_2", sid: "s2" }) };
    expect((await call(request("POST", "/api/sessions/01RUN/events", { body: { events: [{ ...entered, id: "e9" }] } }), asGuest)).status).toBe(422);
    expect((await call(request("DELETE", "/api/sessions/01RUN/members/user_2"), d)).body).toEqual({ removed: true });
    expect((await call(request("GET", "/api/sessions/01RUN"), asGuest)).body).toEqual({ found: false });

    await call(request("POST", "/api/sessions/01RUN/invites", { body: { email: "z@example.com" } }), d);
    expect((await call(request("DELETE", "/api/sessions/01RUN/invites/tok2"), d)).body).toEqual({ revoked: true });
    expect((await call(request("GET", "/api/invites/tok2", { token: null }), d)).body).toEqual({ found: false });
    expect((await call(request("POST", "/api/invites/tok2/accept", { token: "guest" }), d)).status).toBe(410);
  });

  it("mints a command-line key once, uses it as the person, and revokes it", async () => {
    const d = deps();
    const made = await call(request("POST", "/api/keys", { body: { name: "laptop" } }), d);
    expect(made.status).toBe(200);
    const secret = String(made.body["secret"]);
    expect(secret.startsWith("rl_")).toBe(true);
    expect(made.body["key"]).toMatchObject({ name: "laptop", prefix: secret.slice(0, 9) });

    // The key is the person, on any route, but cannot mint more keys.
    const asKey = request("GET", "/api/me", { token: null, headers: { authorization: `Bearer ${secret}` } });
    expect((await call(asKey, d)).body).toMatchObject({ sub: "user_1", sid: expect.stringMatching(/^key:/) as unknown as string });
    expect((await call(request("POST", "/api/keys", { body: { name: "more" }, token: null, headers: { authorization: `Bearer ${secret}` } }), d)).status).toBe(422);
    // Listed without the secret; revoked, it is refused.
    const listed = await call(request("GET", "/api/keys"), d);
    expect(JSON.stringify(listed.body)).not.toContain(secret);
    const id = String((listed.body["keys"] as ApiKey[])[0]!.id);
    expect((await call(request("DELETE", `/api/keys/${id}`), d)).body).toEqual({ revoked: true });
    expect((await call(asKey, d)).status).toBe(401);
    expect((await call(request("GET", "/api/me", { token: null, headers: { authorization: "Bearer rl_nonsense" } }), d)).status).toBe(401);
  });

  it("makes a key that only releases: it reaches the publishing routes and is refused on the rest", async () => {
    const d = deps();
    expect((await call(request("POST", "/api/keys", { body: { name: "ci", scope: "everything" } }), d)).status).toBe(422);
    const made = await call(request("POST", "/api/keys", { body: { name: "ci", scope: "release" } }), d);
    expect(made.body["key"]).toMatchObject({ name: "ci", scope: "release" });
    const secret = String(made.body["secret"]);
    const asKey = (method: string, path: string, body?: unknown) => call(request(method, path, { body, token: null, headers: { authorization: `Bearer ${secret}` } }), d);
    expect((await asKey("GET", "/api/me")).body).toMatchObject({ sub: "user_1", scope: "release" });
    expect((await asKey("GET", "/api/claims")).status).toBe(200);
    expect((await asKey("GET", "/api/publishers/me")).status).toBe(200);
    expect((await asKey("PUT", "/api/packs/p", packBody)).status).toBe(200);
    // Not play, not people, not money, not more keys. Never 403: CloudFront would answer the app's page instead.
    expect((await asKey("GET", "/api/sync/manifest")).status).toBe(422);
    expect((await asKey("GET", "/api/keys")).status).toBe(422);
    expect((await asKey("GET", "/api/publishers/sales")).status).toBe(422);
    expect((await asKey("DELETE", "/api/publishers/members/user_2")).status).toBe(422);
    expect((await asKey("DELETE", "/api/me")).status).toBe(422);
    // A full key, as before, is the person on every route.
    const full = String((await call(request("POST", "/api/keys", { body: { name: "laptop" } }), d)).body["secret"]);
    expect((await call(request("GET", "/api/sync/manifest", { token: null, headers: { authorization: `Bearer ${full}` } }), d)).status).toBe(200);
  });

  it("claims a signing key by proving it, names its owner to anyone, and refuses a second owner", async () => {
    const d = deps();
    await call(request("PUT", "/api/me/profile", { body: { name: "Nate" } }), d);
    // A real key pair, as the CLI makes: sign the nonce, send the public half.
    const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const spki = Buffer.from(await webcrypto.subtle.exportKey("spki", pair.publicKey)).toString("base64url");
    const nonce = String((await call(request("POST", "/api/claims/nonce"), d)).body["nonce"]);
    const sig = Buffer.from(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(nonce))).toString("base64url");

    const claimed = await call(request("POST", "/api/claims", { body: { publicKey: spki, nonce, signature: sig } }), d);
    expect(claimed.status).toBe(200);
    const fp = String((claimed.body["claim"] as Claim).fingerprint);
    expect(fp).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/);

    // Anyone, signed out, can ask who that is.
    const who = await call(request("GET", `/api/authors/${fp}`, { token: null }), d);
    expect(who.body).toMatchObject({ found: true, claim: { name: "Nate", publicKey: spki } });
    expect((await call(request("GET", "/api/authors/AAAA-BBBB", { token: null }), d)).body).toEqual({ found: false });

    // A used nonce is spent; a wrong signature is refused; another account cannot take the key.
    expect((await call(request("POST", "/api/claims", { body: { publicKey: spki, nonce, signature: sig } }), d)).status).toBe(422);
    const nonce2 = String((await call(request("POST", "/api/claims/nonce"), d)).body["nonce"]);
    expect((await call(request("POST", "/api/claims", { body: { publicKey: spki, nonce: nonce2, signature: sig } }), d)).status).toBe(422);
    const other: Deps = { ...d, verify: async () => ({ sub: "user_2", sid: "s2" }) };
    const nonce3 = String((await call(request("POST", "/api/claims/nonce"), other)).body["nonce"]);
    const sig3 = Buffer.from(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(nonce3))).toString("base64url");
    expect((await call(request("POST", "/api/claims", { body: { publicKey: spki, nonce: nonce3, signature: sig3 } }), other)).status).toBe(409);

    // Mine to remove; then nobody.
    expect((await call(request("DELETE", `/api/claims/${fp}`), d)).body).toEqual({ removed: true });
    expect((await call(request("GET", `/api/authors/${fp}`, { token: null }), d)).body).toEqual({ found: false });
  });

  it("deletes twice without complaint, and reads back as gone", async () => {
    const d = deps();
    await call(request("PUT", "/api/packs/p", { body: packBody }), d);
    const first = await call(request("DELETE", "/api/packs/p"), d);
    const second = await call(request("DELETE", "/api/packs/p"), d);
    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect((await call(request("GET", "/api/packs/p"), d)).status).toBe(410);
  });

  it("keeps a license key, and hands it back only to a direct ask", async () => {
    const d = deps();
    const license = { key: "ABCDE-FGHJK-LMNPQ-RSTUV", ref: "order-1", title: "A Game", updatedAt: "2026-09-06T00:00:00Z", hash: "lh" };
    expect((await call(request("GET", "/api/licenses/p"), d)).body).toEqual({ found: false });
    const put = await call(request("PUT", "/api/licenses/p", { body: license }), d);
    expect(put.status).toBe(200);
    expect(put.body["entry"]).toEqual({ id: "p", updatedAt: license.updatedAt, hash: "lh", ref: "order-1", title: "A Game" });

    const got = await call(request("GET", "/api/licenses/p"), d);
    expect(got.body["found"]).toBe(true);
    expect((got.body["license"] as { key: string }).key).toBe(license.key);

    // The manifest says the license exists; the key is not what it is for.
    const manifest = await call(request("GET", "/api/sync/manifest"), d);
    expect(manifest.body).toMatchObject({ licenses: [{ id: "p", hash: "lh" }] });
    expect(JSON.stringify(manifest.body)).not.toContain(license.key);

    expect((await call(request("PUT", "/api/licenses/p", { body: { ...license, key: "   " } }), d)).status).toBe(422);
    expect((await call(request("PUT", "/api/licenses/p", { body: { ...license, key: "x".repeat(201) } }), d)).status).toBe(413);

    await call(request("DELETE", "/api/licenses/p"), d);
    expect((await call(request("GET", "/api/licenses/p"), d)).status).toBe(410);
  });

  it("never answers 403 or 404, whatever is asked", async () => {
    const d = deps();
    const events = [
      request("GET", "/api/me"),
      request("PUT", "/api/me/profile", { body: "nonsense" }),
      request("DELETE", "/api/me"),
      request("GET", "/api/sync/manifest"),
      request("GET", "/api/packs/missing"),
      request("PUT", "/api/packs/p", { body: {} }),
      request("DELETE", "/api/packs/missing"),
      request("GET", "/api/sessions"),
      request("POST", "/api/sessions", { body: "nonsense" }),
      request("GET", "/api/sessions/missing"),
      request("POST", "/api/sessions/missing/events", { body: {} }),
      request("GET", "/api/sessions/missing/invites"),
      request("POST", "/api/sessions/missing/invites", { body: {} }),
      request("DELETE", "/api/sessions/missing/invites/x"),
      request("DELETE", "/api/sessions/missing/members/x"),
      request("GET", "/api/invites/missing", { token: null }),
      request("POST", "/api/invites/missing/accept"),
      request("GET", "/api/people"),
      request("GET", "/api/keys"),
      request("POST", "/api/keys", { body: {} }),
      request("DELETE", "/api/keys/missing"),
      request("POST", "/api/claims/nonce"),
      request("POST", "/api/claims", { body: {} }),
      request("GET", "/api/claims"),
      request("DELETE", "/api/claims/missing"),
      request("GET", "/api/authors/missing", { token: null }),
      request("PATCH", "/api/sessions/missing", { body: {} }),
      request("DELETE", "/api/sessions/missing"),
      request("GET", "/api/licenses/missing"),
      request("PUT", "/api/licenses/p", { body: { key: "" } }),
      request("DELETE", "/api/licenses/missing"),
      request("GET", "/api/whatever/else"),
      request("GET", "/api/me", { token: null }),
    ];
    for (const e of events) {
      const { status } = await call(e, d);
      expect([403, 404], `${e.requestContext.http.method} ${e.rawPath} -> ${status}`).not.toContain(status);
    }
  });
});

describe("discord", () => {
  /** A keypair of the kind Discord holds; the public half as Discord shows it. */
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicHex = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  const signedRequest = (body: unknown, timestamp = "1700000000", tamper = false) => {
    const raw = JSON.stringify(body);
    const signature = sign(null, Buffer.concat([Buffer.from(timestamp), Buffer.from(raw)]), privateKey).toString("hex");
    const event = request("POST", "/api/discord/interactions", { token: null, headers: { "x-signature-ed25519": tamper ? signature.replace(/^./, (c) => (c === "0" ? "1" : "0")) : signature, "x-signature-timestamp": timestamp } });
    return { ...event, body: raw } as APIGatewayProxyEventV2;
  };
  const withBot = (guilds = memoryGuilds()) => deps(memoryStore(), { guilds, discord: { applicationId: "app", publicKey: publicHex, token: async () => null }, code: () => "ABCDEF" });
  const ping = { id: "p1", application_id: "app", type: 1, token: "t" };
  const press = { id: "i1", application_id: "app", type: 2, token: "t", guild_id: "g1", member: { user: { id: "1001", username: "mira", global_name: "Mira" } }, data: { name: "link" } };

  it("answers only what Discord signed, and says so when there is no bot to answer for", async () => {
    // Not configured: nothing to verify against, so nothing is believed.
    expect((await call(signedRequest(ping), deps())).status).toBe(401);
    const d = withBot();
    expect((await call(signedRequest(ping), d)).body).toEqual({ type: 1 });
    expect((await call(signedRequest(ping, "1700000000", true), d)).status).toBe(401);
    // A bearer is neither asked for nor enough: the signature is the credential.
    const bare = { ...request("POST", "/api/discord/interactions", { body: ping }) };
    expect((await call(bare, d)).status).toBe(401);
    expect((await call({ ...signedRequest(ping), body: "{" } as APIGatewayProxyEventV2, d)).status).toBe(401);
  });

  it("links a Discord account to the account that hands in its code, once, and unlinks on request or with the account", async () => {
    const guilds = memoryGuilds();
    const d = withBot(guilds);
    const pressed = await call(signedRequest(press), d);
    expect(pressed.body["data"]).toMatchObject({ flags: 64 });
    expect(String((pressed.body["data"] as Record<string, unknown>)["content"])).toContain("https://runlog.test/#link/discord?c=ABCDEF");
    // Nothing linked yet, and the code is a code: typed loosely, it still matches.
    expect((await call(request("GET", "/api/connections"), d)).body).toEqual({ available: true, discord: null });
    expect((await call(request("POST", "/api/connections/discord", { body: { code: "" } }), d)).status).toBe(422);
    const linked = await call(request("POST", "/api/connections/discord", { body: { code: " abcdef " } }), d);
    expect(linked.body).toEqual({ linked: true, discord: { discordUserId: "1001", name: "Mira", linkedAt: "2026-09-06T12:00:00.000Z" } });
    expect((await call(request("GET", "/api/connections"), d)).body).toMatchObject({ discord: { discordUserId: "1001", name: "Mira" } });
    // Spent: the same code a second time, even from the same person, is refused.
    expect((await call(request("POST", "/api/connections/discord", { body: { code: "ABCDEF" } }), d)).status).toBe(422);
    // Discord's side now knows, and says so rather than minting again.
    const again = await call(signedRequest(press), d);
    expect(String((again.body["data"] as Record<string, unknown>)["content"])).toContain("already linked");
    // Another account handing in a fresh code for the same Discord account takes it over.
    await guilds.putLinkCode({ code: "GHJKLM", discordUserId: "1001", name: "Mira", createdAt: "2026-09-06T12:00:00.000Z", expiresAt: "2026-09-06T12:10:00.000Z" });
    expect((await call(request("POST", "/api/connections/discord", { body: { code: "GHJKLM" }, token: "guest" }), d)).body).toMatchObject({ linked: true });
    expect((await call(request("GET", "/api/connections"), d)).body).toMatchObject({ discord: null });
    expect((await call(request("GET", "/api/connections", { token: "guest" }), d)).body).toMatchObject({ discord: { discordUserId: "1001" } });
    // Unlinking, and deleting the account, both leave nothing behind.
    expect((await call(request("DELETE", "/api/connections/discord", { token: "guest" }), d)).body).toEqual({ unlinked: true });
    expect((await call(request("DELETE", "/api/connections/discord", { token: "guest" }), d)).body).toEqual({ unlinked: false });
    await guilds.connect("user_1", { discordUserId: "1001", name: "Mira", linkedAt: "2026-09-06T12:00:00.000Z" });
    await call(request("DELETE", "/api/me"), d);
    expect(guilds.links.size).toBe(0);
    expect(await guilds.userForDiscord("1001")).toBeNull();
  });

  it("measures every interaction it answers, by kind, never by argument", async () => {
    const measured: Array<{ kind: string; ms: number; ok: boolean }> = [];
    const d = { ...withBot(), measure: (sample: { kind: string; ms: number; ok: boolean }) => void measured.push(sample) };
    await call(signedRequest(ping), d);
    await call(signedRequest(press), d);
    await call(signedRequest({ ...press, data: { name: "setup", options: [{ name: "status", type: 1 }] } }), d);
    await call(signedRequest({ ...press, type: 3, data: { custom_id: "rl:01ABC:tick:3", component_type: 2 } }), d);
    await call(signedRequest({ ...press, type: 5, data: { custom_id: "rl:01ABC:declared", components: [] } }), d);
    expect(measured.map((m) => m.kind)).toEqual(["ping", "link", "setup status", "press:tick", "modal:declared"]);
    for (const m of measured) {
      expect(m.ok).toBe(true);
      expect(m.ms).toBeGreaterThanOrEqual(0);
    }
    // What was never signed was never measured.
    await call(signedRequest(ping, "1700000000", true), d);
    expect(measured).toHaveLength(5);
  });

  it("refuses a code past its ten minutes", async () => {
    const guilds = memoryGuilds();
    const d = withBot(guilds);
    await guilds.putLinkCode({ code: "OLDONE", discordUserId: "1001", name: "Mira", createdAt: "2026-09-06T11:00:00.000Z", expiresAt: "2026-09-06T11:10:00.000Z" });
    expect((await call(request("POST", "/api/connections/discord", { body: { code: "OLDONE" } }), d)).status).toBe(422);
    expect(guilds.codes.size).toBe(0);
  });
});

describe("a claimed server", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicHex = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  const signed = (body: unknown) => {
    const raw = JSON.stringify(body);
    const signature = sign(null, Buffer.concat([Buffer.from("1700000000"), Buffer.from(raw)]), privateKey).toString("hex");
    return { ...request("POST", "/api/discord/interactions", { token: null, headers: { "x-signature-ed25519": signature, "x-signature-timestamp": "1700000000" } }), body: raw } as APIGatewayProxyEventV2;
  };
  const claimPress = (guildId: string) => ({ id: "i1", application_id: "app", type: 2, token: "t", guild_id: guildId, member: { user: { id: "1001", username: "mira" }, permissions: "32" }, data: { name: "setup", options: [{ name: "claim", type: 1 }] } });
  const pack = { title: "The Long Kiln", version: "1.0.0", format: "yaml", hash: "h1", modes: [{ id: "standard", label: "Standard" }, { id: "short", label: "Short" }], source: "id: com.scrthq.runlog.long-kiln\n" };

  it("is claimed by handing in the code, lists for its owner alone, takes packs into a vault it never hands back, and is released whole", async () => {
    const guilds = memoryGuilds();
    let codes = 0;
    const d = deps(memoryStore(), { guilds, discord: { applicationId: "app", publicKey: publicHex, token: async () => null, open: true, guildName: async (id) => (id === "g1" ? "The Kiln Room" : null) }, code: () => `CLAIM${"ABCDEFGH"[codes++]}` });
    await call(signed(claimPress("g1")), d);
    // With plans off, nothing to upgrade to; the server is simply claimed, and named by Discord where the bot could ask.
    const claimed = await call(request("POST", "/api/guilds/claim", { body: { code: "claima" } }), d);
    expect(claimed.body).toEqual({ claimed: true, plan: "server", upgrade: false, guild: { guildId: "g1", name: "The Kiln Room", ownerSub: "user_1", claimedAt: "2026-09-06T12:00:00.000Z", updatedAt: "2026-09-06T12:00:00.000Z" } });
    expect((await call(request("POST", "/api/guilds/claim", { body: { code: "claima" } }), d)).status).toBe(422);
    expect((await call(request("GET", "/api/guilds"), d)).body).toMatchObject({ server: true, guilds: [{ guildId: "g1" }] });
    expect((await call(request("GET", "/api/guilds", { token: "guest" }), d)).body).toMatchObject({ guilds: [] });
    // The vault: the owner puts a pack in, sees it listed without its text, and nobody else sees the server at all.
    const kept = await call(request("PUT", "/api/guilds/g1/packs/com.scrthq.runlog.long-kiln", { body: pack }), d);
    expect(kept.body).toMatchObject({ kept: true, pack: { id: "com.scrthq.runlog.long-kiln", title: "The Long Kiln", modes: pack.modes, bytes: Buffer.byteLength(pack.source), delegatedBy: "user_1" } });
    const listed = await call(request("GET", "/api/guilds/g1/packs"), d);
    expect(listed.body["packs"]).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain("source");
    expect((await call(request("GET", "/api/guilds/g1/packs", { token: "guest" }), d)).body).toEqual({ found: false });
    expect((await call(request("PUT", "/api/guilds/g1/packs/x", { body: { ...pack, format: "toml" } }), d)).status).toBe(422);
    expect((await call(request("DELETE", "/api/guilds/g1/packs/com.scrthq.runlog.long-kiln"), d)).body).toEqual({ removed: true });
    await call(request("PUT", "/api/guilds/g1/packs/com.scrthq.runlog.long-kiln", { body: pack }), d);
    // Releasing takes the server's rows and its vault with it.
    expect((await call(request("DELETE", "/api/guilds/g1", { token: "guest" }), d)).body).toEqual({ found: false });
    expect((await call(request("DELETE", "/api/guilds/g1"), d)).body).toEqual({ released: 3 });
    expect(guilds.vault.size).toBe(0);
    expect((await call(request("GET", "/api/guilds"), d)).body).toMatchObject({ guilds: [] });
  });

  it("says when the owner has no server plan where plans gate, allows three servers, and moves with a new claim", async () => {
    const guilds = memoryGuilds();
    const billing = memoryBilling();
    let codes = 0;
    const d = deps(memoryStore(), { guilds, billing, gates: true, features: { plus: "plus", hostedLicensing: "hosted-licensing", server: "server" }, discord: { applicationId: "app", publicKey: publicHex, token: async () => null, open: true }, code: () => `CLAIM${"ABCDEFGH"[codes++]}` });
    for (const g of ["g1", "g2", "g3", "g4"]) await call(signed(claimPress(g)), d);
    expect((await call(request("POST", "/api/guilds/claim", { body: { code: "CLAIMA" } }), d)).body).toMatchObject({ claimed: true, upgrade: true });
    await billing.putEntitlements("user_1", ["server"], "now");
    expect((await call(request("POST", "/api/guilds/claim", { body: { code: "CLAIMB" } }), d)).body).toMatchObject({ claimed: true, upgrade: false });
    expect((await call(request("POST", "/api/guilds/claim", { body: { code: "CLAIMC" } }), d)).body).toMatchObject({ claimed: true });
    expect((await call(request("POST", "/api/guilds/claim", { body: { code: "CLAIMD" } }), d)).status).toBe(422);
    expect((await call(request("GET", "/api/guilds"), d)).body).toMatchObject({ server: true });
    // Another account claiming one of them takes it over; the first account's list shrinks, and the vault, which was the first account's packs, empties.
    await call(request("PUT", "/api/guilds/g1/packs/com.scrthq.runlog.long-kiln", { body: { title: "The Long Kiln", version: "1", format: "yaml", hash: "h", modes: [], source: "id: x" } }), d);
    expect(guilds.vault.size).toBe(1);
    await call(signed(claimPress("g1")), d);
    expect((await call(request("POST", "/api/guilds/claim", { body: { code: "CLAIME" }, token: "guest" }), d)).body).toMatchObject({ claimed: true, guild: { guildId: "g1", ownerSub: "user_2" } });
    expect(guilds.vault.size).toBe(0);
    expect(((await call(request("GET", "/api/guilds"), d)).body["guilds"] as unknown[]).length).toBe(2);
    // Deleting the account releases what it owned.
    await call(request("DELETE", "/api/me"), d);
    expect(guilds.guilds.has("g2")).toBe(false);
    expect(guilds.guilds.has("g1")).toBe(true);
  });

  it("is offered wherever there is a bot, on sale only where the stage says so, and held by the flag named like the feature meanwhile", async () => {
    const guilds = memoryGuilds();
    let codes = 0;
    const bot = { applicationId: "app", publicKey: publicHex, token: async () => null };
    const flagged = async (authorization: string | undefined) => {
      if (authorization === "Bearer good") return { sub: "user_1", sid: "session_1", flags: ["server"] };
      if (authorization === "Bearer guest") return { sub: "user_2", sid: "session_2" };
      throw new Error("bad token");
    };
    const d = deps(memoryStore(), { guilds, gates: true, discord: bot, verify: flagged, code: () => `CLAIM${"ABCDEFGH"[codes++]}` });
    // Without a bot there is no tier at all; with one it is offered to everyone, and not yet for sale.
    expect((await call(request("GET", "/api/me"), deps())).body).toMatchObject({ servers: false, serversOpen: false });
    expect((await call(request("GET", "/api/me", { token: "guest" }), d)).body).toMatchObject({ servers: true, serversOpen: false });
    // Anyone may claim a server and see the plan as coming; the flag on a session is the plan, the way a plus flag is Plus.
    await call(signed(claimPress("g1")), d);
    expect((await call(request("POST", "/api/guilds/claim", { body: { code: "CLAIMA" }, token: "guest" }), d)).body).toMatchObject({ claimed: true, upgrade: true });
    expect((await call(request("GET", "/api/guilds", { token: "guest" }), d)).body).toMatchObject({ server: false, open: false });
    expect((await call(request("GET", "/api/me"), d)).body["entitlements"]).toContain("server");
    expect((await call(request("GET", "/api/guilds"), d)).body).toMatchObject({ server: true, open: false });
    // The stage putting it on sale is a configuration, not a code change.
    const open = deps(memoryStore(), { guilds, discord: { ...bot, open: true } });
    expect((await call(request("GET", "/api/me", { token: "guest" }), open)).body).toMatchObject({ servers: true, serversOpen: true });
  });
});

describe("a run hosted in discord", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicHex = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  const signed = (body: unknown) => {
    const raw = JSON.stringify(body);
    const signature = sign(null, Buffer.concat([Buffer.from("1700000000"), Buffer.from(raw)]), privateKey).toString("hex");
    return { ...request("POST", "/api/discord/interactions", { token: null, headers: { "x-signature-ed25519": signature, "x-signature-timestamp": "1700000000" } }), body: raw } as APIGatewayProxyEventV2;
  };
  const demo = readFileSync(join(__dirname, "..", "..", "..", "packs", "demo", "pack.yaml"), "utf8");
  const PACK = "com.scrthq.runlog.long-kiln";
  const mira = { id: "1001", username: "mira", global_name: "Mira" };
  const sam = { id: "1002", username: "sam", global_name: "Sam" };
  const member = (user: typeof mira, permissions = "0") => ({ user, permissions, roles: [] as string[] });
  const command = (options: unknown, user = mira, channel = "chan") => ({ id: "i", application_id: "app", type: 2, token: "t", guild_id: "g1", channel_id: channel, member: member(user, user === mira ? "32" : "0"), data: { name: "run", options: [options] } });
  const press = (customId: string, user = mira, extra: Record<string, unknown> = {}) => ({ id: "i", application_id: "app", type: 3, token: "t", guild_id: "g1", channel_id: "thread_1", member: member(user, user === mira ? "32" : "0"), message: { id: "msg_1" }, data: { custom_id: customId, component_type: 2, ...extra } });
  const typed = (customId: string, value: string) => ({ id: "i", application_id: "app", type: 5, token: "t", guild_id: "g1", channel_id: "thread_1", member: member(mira, "32"), message: { id: "msg_1" }, data: { custom_id: customId, components: [{ components: [{ custom_id: "x", value }] }] } });
  const content = (out: { body: Record<string, unknown> }) => String((out.body["data"] as Record<string, unknown>)["content"]);

  /** The demo pack with a one-minute timer on every unit: started by the bot, or left to the player. */
  const timed = (auto: boolean) =>
    demo
      .replace(/capabilities:\r?\n/, "capabilities:\n  - timers\n")
      .replace(/unit:\r?\n  createsSubject: true\r?\n/, `unit:\n  createsSubject: true\n  clock: { kind: timer, minutes: 1, auto: ${auto}, label: The Firing }\n`);

  async function table(source = demo) {
    const guilds = memoryGuilds();
    const bot = memoryDiscord();
    const store = memoryStore();
    let ids = 0;
    await guilds.claimGuild({ guildId: "g1", name: "The Kiln Room", ownerSub: "user_1", claimedAt: "2026-09-06T12:00:00.000Z" });
    await guilds.connect("user_1", { discordUserId: "1001", name: "Mira", linkedAt: "2026-09-06T12:00:00.000Z" });
    await guilds.putGuildPack("g1", { id: PACK, title: "The Long Kiln", version: "1", format: "yaml", hash: `h${source.length}`, bytes: source.length, modes: [{ id: "standard", label: "Standard" }], updatedAt: "2026-09-06T12:00:00.000Z", delegatedBy: "user_1" }, source);
    const d = deps(store, {
      guilds,
      discord: { applicationId: "app", publicKey: publicHex, token: async () => null, open: true, rest: async () => bot },
      mintId: () => `01${String((ids += 1)).padStart(24, "0")}`,
      token: () => "livetok",
    });
    return { guilds, bot, store, d };
  }

  /** The first press the card offers: a button in its first row, or a select with its first option. */
  const firstPress = (card: Record<string, unknown>): { customId: string; value?: string } | null => {
    const rows = card["components"] as Array<{ components: Array<{ custom_id: string; type: number; disabled?: boolean; label?: string; options?: Array<{ value: string }> }> }>;
    for (const row of rows) {
      for (const c of row.components) {
        // Never Undo, which a person would not press to move forward; never a box already ticked.
        if (c.type === 2 && !c.disabled && !(c.label ?? "").startsWith("☑") && !c.custom_id.endsWith(":undo")) return { customId: c.custom_id };
        if (c.type === 3 && c.options?.[0]) return { customId: c.custom_id, value: c.options[0].value };
      }
    }
    return null;
  };

  it("starts in a thread with a pinned card and a live link, and the host plays a whole unit from the card while everyone else watches", async () => {
    const { guilds, bot, store, d } = await table();
    // Somebody who cannot manage the server, with no host role set, cannot host.
    const stranger = await call(signed(command({ name: "start", type: 1, options: [{ name: "pack", type: 3, value: PACK }, { name: "mode", type: 3, value: "standard" }] }, sam)), d);
    expect(content(stranger)).toContain("manage the server");
    const started = await call(signed(command({ name: "start", type: 1, options: [{ name: "pack", type: 3, value: PACK }, { name: "mode", type: 3, value: "standard" }, { name: "name", type: 3, value: "First firing" }] })), d);
    expect(content(started)).toContain("**Mira** started **The Long Kiln · Standard Firing** — First firing in <#thread_1>");
    expect(content(started)).toContain("https://runlog.test/r/01000000000000000000000001?t=livetok");
    expect(bot.threads).toEqual(["thread_1 The Long Kiln · Standard Firing · First firing"]);
    expect(bot.pins).toEqual(["msg_2"]);
    const run = await guilds.guildRun("01000000000000000000000001");
    expect(run).toMatchObject({ hostSub: "user_1", hostDiscordId: "1001", threadId: "thread_1", cardMessageId: "msg_2" });
    // The session is the host account's, like any run, and a stranger with the link already reads the table.
    expect((await call(request("GET", "/api/sessions/01000000000000000000000001"), d)).body["session"]).toMatchObject({ ownerSub: "user_1", packTitle: "The Long Kiln", name: "First firing" });
    const metrics = await call(request("GET", "/api/public/runs/01000000000000000000000001/metrics?t=livetok", { token: null }), d);
    expect(metrics.body).toMatchObject({ ready: true, unit: 0, runName: "First firing" });

    // A watcher pressing is told so; the host plays the card until the unit closes.
    let card = bot.posts[0]!.message as unknown as Record<string, unknown>;
    const first = firstPress(card)!;
    expect(first.customId).toBe("rl:01000000000000000000000001:enter");
    expect(content(await call(signed(press(first.customId, sam)), d))).toContain("Only the host");
    /** Press whatever the card offers until `units` stages have been closed, answering any modal with a bowl. */
    const playUntil = async (units: number) => {
      let presses = 0;
      let closed = false;
      while (presses < 80 && !closed) {
        presses += 1;
        const next = firstPress(card);
        if (!next) break;
        let out = await call(signed(press(next.customId, mira, next.value ? { values: [next.value] } : {})), d);
        // A modal was opened: answer it.
        if (out.body["type"] === 9) out = await call(signed(typed(String((out.body["data"] as Record<string, unknown>)["custom_id"]), "A wide bowl")), d);
        expect(out.body["type"], `${next.customId}: ${JSON.stringify(out.body["data"])}`).toBe(7);
        card = out.body["data"] as Record<string, unknown>;
        closed = (await store.eventsAfter("01000000000000000000000001", 0)).filter((e) => e["t"] === "UnitFinalized").length >= units;
      }
      const events = await store.eventsAfter("01000000000000000000000001", 0);
      expect(closed, JSON.stringify({ presses, rows: card["components"], last: events.slice(-8).map((e) => `${e["t"]}${e["t"] === "StepCompleted" ? `:${e["phase"]}#${e["step"]}` : ""}`) })).toBe(true);
      return events;
    };
    const events = await playUntil(2);
    // The bot rolled, and said so: nothing physical happened at this table.
    const rolled = events.filter((e) => e["t"] === "Rolled");
    expect(rolled.length).toBeGreaterThan(0);
    expect(rolled.every((e) => e["source"] === "rng")).toBe(true);
    expect(events.some((e) => e["t"] === "OutcomeResolved")).toBe(true);
    expect(events.some((e) => e["t"] === "SubjectDeclared" && e["subjectType"] === "A wide bowl")).toBe(true);
    // Every event is the host account's, stamped the way the app stamps.
    // An id is a ULID minted here, or the engine's own where it gives one (an obligation resolved is named for the obligation).
    const badly = events.filter((e) => !(e["author"] === "user_1" && typeof e["id"] === "string" && e["id"].length > 0));
    expect(badly, JSON.stringify(badly)).toEqual([]);
    // The table was told in the thread, and the widgets see the same run.
    expect(bot.posts.filter((p) => p.channel === "thread_1" && p.message.content && !p.message.content.includes("Watch it live")).length).toBeGreaterThan(0);
    const after = await call(request("GET", "/api/public/runs/01000000000000000000000001/metrics?t=livetok", { token: null }), d);
    expect(after.body).toMatchObject({ ready: true, unit: 2 });
    expect((after.body["progress"] as Record<string, unknown>)["unitsDone"]).toBe(2);

    // /run status re-posts the card in the thread; /run end closes the run and the thread.
    const cardsBefore = bot.posts.filter((p) => Array.isArray(p.message.embeds)).length;
    const status = await call(signed(command({ name: "status", type: 1 }, mira, "thread_1")), d);
    expect(content(status)).toContain("Posted a fresh card");
    const freshest = bot.posts[bot.posts.length - 1]!;
    expect(bot.posts.filter((p) => Array.isArray(p.message.embeds)).length).toBe(cardsBefore + 1);
    expect((await guilds.guildRun("01000000000000000000000001"))?.cardMessageId).toBe(freshest.id);
    // The old card lost its buttons, so a press on it cannot drive the table from a stale view.
    expect(bot.edits[bot.edits.length - 1]).toMatchObject({ id: "msg_2", message: { components: [] } });
    expect(content(await call(signed(command({ name: "end", type: 1 }, sam, "thread_1")), d))).toContain("Only the host");
    const end = () => call(signed(command({ name: "end", type: 1, options: [{ name: "ending", type: 3, value: "kept" }] }, mira, "thread_1")), d);
    let ended = await end();
    // The dice may have queued a forced stage, which must be played out before the firing can end.
    for (let more = 3; content(ended).includes("still queued") && more <= 5; more += 1) {
      card = freshest.message as unknown as Record<string, unknown>;
      await playUntil(more);
      ended = await end();
    }
    expect(content(ended)).toContain("The Shelf");
    // The thread stays open to talk in; Discord closes it after a day idle.
    expect(bot.archived).toEqual([]);
    expect((await call(request("GET", "/api/sessions/01000000000000000000000001"), d)).body["session"]).toMatchObject({ endedAt: "2026-09-06T12:00:00.000Z" });
    expect(content(await call(signed(press("rl:01000000000000000000000001:enter")), d))).toContain("has ended");
  });

  it("refuses to host where the owner has no server plan and plans gate, where Discord will not open a thread, and where the bot has no token", async () => {
    const { d, bot } = await table();
    const start = command({ name: "start", type: 1, options: [{ name: "pack", type: 3, value: PACK }, { name: "mode", type: 3, value: "standard" }] });
    const gated = { ...d, gates: true, features: { plus: "plus", hostedLicensing: "hosted-licensing", server: "server" } };
    expect(content(await call(signed(start), gated))).toContain("needs the server plan");
    bot.down = true;
    expect(content(await call(signed(start), d))).toContain("would not open a thread");
    const noToken = { ...d, discord: { ...d.discord!, rest: async () => null } };
    expect(content(await call(signed(start), noToken))).toContain("token is not filled");
  });

  it("offers the vault packs and their modes as the command is typed", async () => {
    const { d } = await table();
    const ask = (name: string, value: string, options: unknown[] = []) => ({ id: "i", application_id: "app", type: 4, token: "t", guild_id: "g1", member: member(mira, "32"), data: { name: "run", options: [{ name: "start", type: 1, options: [...options, { name, type: 3, value, focused: true }] }] } });
    expect((await call(signed(ask("pack", "lon")), d)).body).toEqual({ type: 8, data: { choices: [{ name: "The Long Kiln", value: PACK }] } });
    expect((await call(signed(ask("mode", "", [{ name: "pack", type: 3, value: PACK }])), d)).body).toEqual({ type: 8, data: { choices: [{ name: "Standard", value: "standard" }] } });
    expect((await call(signed(ask("pack", "zzz")), d)).body).toEqual({ type: 8, data: { choices: [] } });
  });
  it("takes a move back, writes the journal, and takes a wave from anyone, from the thread", async () => {
    const { bot, store, d } = await table();
    const id = "01000000000000000000000001";
    await call(signed(command({ name: "start", type: 1, options: [{ name: "pack", type: 3, value: PACK }, { name: "mode", type: 3, value: "standard" }] })), d);
    // The card and the link are one message, pinned: a start is one post.
    expect(bot.posts).toHaveLength(1);
    expect(bot.posts[0]!.message.content).toContain("Watch it live");
    expect(Array.isArray(bot.posts[0]!.message.embeds)).toBe(true);
    const journal = (text: string, user = mira) => ({ id: "i", application_id: "app", type: 2, token: "t", guild_id: "g1", channel_id: "thread_1", member: member(user, user === mira ? "32" : "0"), data: { name: "journal", options: [{ name: "text", type: 3, value: text }] } });
    // Nothing to write before the first unit, and nothing to take back but the start.
    expect(content(await call(signed(journal("too soon")), d))).toContain("Nothing to write about");
    expect((await call(signed(press(`rl:${id}:enter`)), d)).body["type"]).toBe(7);
    expect((await call(request("GET", `/api/public/runs/${id}/metrics?t=livetok`, { token: null }), d)).body).toMatchObject({ unit: 1 });
    // Undo from the thread: the unit is back to nothing, as an event, never by shortening the log.
    const undone = await call(signed(command({ name: "undo", type: 1 }, mira, "thread_1")), d);
    expect(content(undone)).toContain("Took the last move back");
    const events = await store.eventsAfter(id, 0);
    expect(events[events.length - 1]).toMatchObject({ t: "Undone", author: "user_1" });
    expect((await call(request("GET", `/api/public/runs/${id}/metrics?t=livetok`, { token: null }), d)).body).toMatchObject({ unit: 0 });
    expect(content(await call(signed(command({ name: "undo", type: 1 }, sam, "thread_1")), d))).toContain("Only the host");
    // The journal, once there is a unit to write about; the line is posted under the card.
    await call(signed(press(`rl:${id}:enter`)), d);
    expect(content(await call(signed(journal("Slip trailed, then waited.")), d))).toContain("📓 Slip trailed");
    expect((await store.eventsAfter(id, 0)).some((e) => e["t"] === "JournalWritten" && e["unit"] === 1 && e["text"] === "Slip trailed, then waited.")).toBe(true);
    expect(content(await call(signed(journal("mine", sam)), d))).toContain("Only the host");
    // A wave from a watcher lands where the live page's waves land, and rings the same bell.
    const waved = await call(signed(press(`rl:${id}:wave`, sam, { values: ["🔥"] })), d);
    expect(waved.body["type"]).toBe(7);
    expect((await call(request("GET", `/api/sessions/${id}/reactions`), d)).body["reactions"]).toMatchObject([{ emoji: "🔥", name: "Sam" }]);
    expect(content(await call(signed(press(`rl:${id}:wave`, sam, { values: ["🍕"] })), d))).toContain("Not one of the six");
    // A stale card cannot begin a unit the table is already in.
    expect(content(await call(signed(press(`rl:${id}:enter`)), d))).toContain("stale");
  });
  it("answers a start at once where there is a function with time, and the job fills the reply in", async () => {
    const { bot, d } = await table();
    const handed: unknown[] = [];
    const deferring = { ...d, defer: async (interaction: unknown) => void handed.push(interaction) };
    const start = command({ name: "start", type: 1, options: [{ name: "pack", type: 3, value: PACK }, { name: "mode", type: 3, value: "standard" }] });
    // What can refuse still refuses in this turn, without deferring.
    expect(content(await call(signed({ ...start, member: member(sam, "0") }), deferring))).toContain("manage the server");
    expect(handed).toHaveLength(0);
    // What cannot is handed over, and Discord is told to wait.
    expect((await call(signed(start), deferring)).body).toEqual({ type: 5 });
    expect(handed).toHaveLength(1);
    expect(bot.threads).toHaveLength(0);
    // The job does the work and writes the answer into the waiting reply,
    // and measures itself as the job it is, not as the command's own turn.
    const measured: Array<{ kind: string; ms: number; ok: boolean }> = [];
    await finishDeferred(handed[0] as Parameters<typeof finishDeferred>[0], { ...d, measure: (sample) => void measured.push(sample) });
    expect(bot.threads).toHaveLength(1);
    expect(bot.originals).toHaveLength(1);
    expect(bot.originals[0]!.message.content).toContain("started **The Long Kiln · Standard Firing** in <#thread_1>");
    expect(bot.originals[0]!.token).toBe("t");
    expect(measured).toMatchObject([{ kind: "job:run start", ok: true }]);
  });
  it("keeps a timer's deadline with a schedule, stops it when the schedule comes back, and finds it stopped at the next press otherwise", async () => {
    expect(timed(true)).toContain("auto: true");
    const { bot, store, d } = await table(timed(true));
    let clock = "2026-09-06T12:00:00.000Z";
    const timers: TimerJob[] = [];
    const dd: Deps = { ...d, now: () => clock, schedule: async (job) => void timers.push(job) };
    const id = "01000000000000000000000001";
    expect(content(await call(signed(command({ name: "start", type: 1, options: [{ name: "pack", type: 3, value: PACK }, { name: "mode", type: 3, value: "standard" }] })), dd))).toContain("started");
    // Beginning the unit starts its timer, and somebody is asked to come back a minute later.
    expect((await call(signed(press(`rl:${id}:enter`)), dd)).body["type"]).toBe(7);
    expect(timers).toEqual([{ sessionId: id, clock: "u1:unit", at: "2026-09-06T12:01:00.000Z" }]);
    // Come back early — a pause moved nothing here, but the job checks — and it is asked for again, not stopped.
    expect(await finishTimer(timers[0]!, dd)).toBe("later");
    expect(timers).toHaveLength(2);
    expect((await store.eventsAfter(id, 0)).filter((e) => e["t"] === "ClockStopped")).toHaveLength(0);
    // Paused, the deadline is nobody's to keep; resumed, it is a new deadline, asked for anew.
    expect((await call(signed(press(`rl:${id}:clock:pause:u1:unit`)), dd)).body["type"]).toBe(7);
    clock = "2026-09-06T12:00:30.000Z";
    expect((await call(signed(press(`rl:${id}:clock:resume:u1:unit`)), dd)).body["type"]).toBe(7);
    expect(timers[timers.length - 1]).toEqual({ sessionId: id, clock: "u1:unit", at: "2026-09-06T12:01:30.000Z" });
    expect(await finishTimer(timers[0]!, dd)).toBe("later");
    // At the deadline the timer is stopped as run out, at the moment it ran out; the thread hears, the card is redrawn.
    clock = "2026-09-06T12:02:00.000Z";
    const postsBefore = bot.posts.length;
    const editsBefore = bot.edits.length;
    expect(await finishTimer(timers[timers.length - 1]!, dd)).toBe("stopped");
    const stopped = (await store.eventsAfter(id, 0)).filter((e) => e["t"] === "ClockStopped");
    expect(stopped).toMatchObject([{ clock: "u1:unit", expired: true, elapsedMs: 60000, at: "2026-09-06T12:01:30.000Z" }]);
    expect(bot.posts.length).toBe(postsBefore + 1);
    expect(bot.posts[bot.posts.length - 1]!.message.content).toContain("The Firing ran out");
    expect(bot.edits.length).toBe(editsBefore + 1);
    // Stopped is stopped: the same deadline again does nothing, and a later look at the run finds no new line.
    expect(await finishTimer(timers[timers.length - 1]!, dd)).toBe("gone");
    expect(await finishTimer({ sessionId: "nope", clock: "u1:unit", at: clock }, dd)).toBe("gone");

    // Without a schedule, the next press notices: the timer is stopped first, and the press lands after it.
    const late = await table(timed(true));
    let later = "2026-09-06T12:00:00.000Z";
    const ld: Deps = { ...late.d, now: () => later };
    expect(content(await call(signed(command({ name: "start", type: 1, options: [{ name: "pack", type: 3, value: PACK }, { name: "mode", type: 3, value: "standard" }] })), ld))).toContain("started");
    const entered = await call(signed(press(`rl:${id}:enter`)), ld);
    later = "2026-09-06T12:05:00.000Z";
    const next = firstPress(entered.body["data"] as Record<string, unknown>);
    expect(next).not.toBeNull();
    expect((await call(signed(press(next!.customId, mira, next!.value ? { values: [next!.value] } : {})), ld)).body["type"]).toBe(7);
    const log = await late.store.eventsAfter(id, 0);
    const ranOut = log.findIndex((e) => e["t"] === "ClockStopped" && e["expired"] === true);
    expect(ranOut).toBeGreaterThan(-1);
    expect(log[ranOut]).toMatchObject({ at: "2026-09-06T12:01:00.000Z" });
    expect(log.length).toBeGreaterThan(ranOut + 1);
    expect(late.bot.posts.some((p) => p.message.content?.startsWith("\u23f0 The Firing ran out."))).toBe(true);
  });

  it("lets a server whose members bought the plan through Discord's store host runs, and tells the profile which servers did", async () => {
    const { guilds, d } = await table();
    await guilds.claimGuild({ guildId: "g2", name: "Another Room", ownerSub: "user_1", claimedAt: "2026-09-06T12:00:00.000Z" });
    const gated: Deps = { ...d, gates: true, discord: { ...d.discord!, entitled: async (g) => g === "g1" } };
    // The account holds no grant; the server's own subscription carries it.
    const start = command({ name: "start", type: 1, options: [{ name: "pack", type: 3, value: PACK }, { name: "mode", type: 3, value: "standard" }] });
    expect(content(await call(signed(start), gated))).toContain("started");
    const elsewhere = { ...start, guild_id: "g2" };
    expect(content(await call(signed(elsewhere), gated))).toContain("subscribes through Discord's store");
    // The profile's list says which server bought it there.
    const listed = (await call(request("GET", "/api/guilds"), gated)).body["guilds"] as Array<{ guildId: string; discord?: boolean }>;
    expect(listed.find((g) => g.guildId === "g1")?.discord).toBe(true);
    expect(listed.find((g) => g.guildId === "g2")?.discord).toBeUndefined();
    // Without a store to ask, nothing is claimed either way.
    const plain = (await call(request("GET", "/api/guilds"), { ...gated, discord: d.discord })).body["guilds"] as Array<{ discord?: boolean }>;
    expect(plain.every((g) => g.discord === undefined)).toBe(true);
  });

  it("hears in the thread what the host does from the app: the lines, a fresh card, and the end", async () => {
    const { guilds, bot, d } = await table();
    const moved: Array<{ sessionId: string; seq: number }> = [];
    const dd: Deps = { ...d, later: async (job) => void moved.push(job) };
    const id = "01000000000000000000000001";
    expect(content(await call(signed(command({ name: "start", type: 1, options: [{ name: "pack", type: 3, value: PACK }, { name: "mode", type: 3, value: "standard" }] })), dd))).toContain("started");
    expect((await guilds.guildRun(id))?.seenSeq).toBeGreaterThan(0);
    // A press from Discord tells the job nothing: the thread heard it as it happened.
    expect((await call(signed(press(`rl:${id}:enter`)), dd)).body["type"]).toBe(7);
    expect(moved).toHaveLength(0);
    const heard = (await guilds.guildRun(id))!.seenSeq!;
    // The host, in the app, takes the move back and begins again; the route hands the run to the job.
    const undo = await call(request("POST", `/api/sessions/${id}/events`, { body: { events: [{ t: "Undone", at: "2026-09-06T12:01:00Z", id: "app_1", move: "app_m1", ids: [] }] } }), dd);
    expect(undo.status).toBe(200);
    const again = await call(request("POST", `/api/sessions/${id}/events`, { body: { events: [{ t: "UnitEntered", at: "2026-09-06T12:01:30Z", id: "app_2", move: "app_m2" }] } }), dd);
    expect(again.status).toBe(200);
    expect(moved).toEqual([{ sessionId: id, seq: heard + 1 }, { sessionId: id, seq: heard + 2 }]);
    // The job tells the thread once for both, redraws the card, and remembers how far it heard.
    const posts = bot.posts.length;
    const edits = bot.edits.length;
    expect(await finishMoved(moved[0]!, dd)).toBe("told");
    expect(bot.posts).toHaveLength(posts + 1);
    expect(bot.posts[bot.posts.length - 1]!.message.content).toContain("From the app:");
    expect(bot.posts[bot.posts.length - 1]!.message.content).toContain("Took a move back.");
    // The undo named no ids, so the app's begin opened the next stage; the line reads the log as it is.
    expect(bot.posts[bot.posts.length - 1]!.message.content).toMatch(/Stage \d begins\./);
    expect(bot.edits).toHaveLength(edits + 1);
    expect((await guilds.guildRun(id))!.seenSeq).toBe(heard + 2);
    // Nothing new: nothing said.
    expect(await finishMoved(moved[1]!, dd)).toBe("quiet");
    expect(bot.posts).toHaveLength(posts + 1);
    // The app ends the run; the thread hears that too, and the card is done pressing.
    expect((await call(request("POST", `/api/sessions/${id}/events`, { body: { events: [{ t: "RunEnded", at: "2026-09-06T12:02:00Z", id: "app_3", move: "app_m3", ending: "kept" }] } }), dd)).status).toBe(200);
    expect(await finishMoved(moved[moved.length - 1]!, dd)).toBe("told");
    expect(bot.posts[bot.posts.length - 1]!.message.content).toContain("The firing is over: The Shelf.");
    expect((await guilds.guildRun(id))!.endedAt).toBeTruthy();
    expect(content(await call(signed(press(`rl:${id}:enter`)), dd))).toContain("has ended");
    // An ended run the app writes to again is nobody's to tell.
    expect(await finishMoved({ sessionId: id, seq: 99 }, dd)).toBe("gone");
    expect(moved).toHaveLength(3);
  });

  it("offers a clock the pack leaves to the player, once per open unit", async () => {
    const { bot, store, d } = await table(timed(false));
    const timers: TimerJob[] = [];
    const dd: Deps = { ...d, schedule: async (job) => void timers.push(job) };
    const id = "01000000000000000000000001";
    expect(content(await call(signed(command({ name: "start", type: 1, options: [{ name: "pack", type: 3, value: PACK }, { name: "mode", type: 3, value: "standard" }] })), dd))).toContain("started");
    const entered = await call(signed(press(`rl:${id}:enter`)), dd);
    const labels = (card: Record<string, unknown>) => (card["components"] as Array<{ components: Array<{ label?: string; custom_id: string }> }>).flatMap((r) => r.components.map((c) => c.label ?? c.custom_id));
    expect(labels(entered.body["data"] as Record<string, unknown>)).toContain("Start The Firing");
    expect(timers).toHaveLength(0);
    const started = await call(signed(press(`rl:${id}:clock:start`)), dd);
    expect(started.body["type"]).toBe(7);
    expect(labels(started.body["data"] as Record<string, unknown>)).toContain("Pause The Firing");
    expect((await store.eventsAfter(id, 0)).filter((e) => e["t"] === "ClockStarted")).toMatchObject([{ clock: "u1:unit", seconds: 60, label: "The Firing" }]);
    expect(timers).toEqual([{ sessionId: id, clock: "u1:unit", at: "2026-09-06T12:01:00.000Z" }]);
    expect(bot.posts[bot.posts.length - 1]!.message.content).toContain("The Firing started.");
    // Once: the unit has its clock.
    expect(content(await call(signed(press(`rl:${id}:clock:start`)), dd))).toContain("has its clock already");
    // A watcher cannot start it.
    expect(content(await call(signed(press(`rl:${id}:clock:start`, sam)), dd))).toContain("Only the host");
  });

  it("seats several in a mode played by several: a seat presses, an open chair is anyone\u2019s, a linked seat follows the run home", async () => {
    const { guilds, bot, store, d } = await table();
    await guilds.putGuildPack("g1", { id: PACK, title: "The Long Kiln", version: "1", format: "yaml", hash: "h", bytes: demo.length, modes: [{ id: "standard", label: "Standard" }, { id: "pairs", label: "Pairs" }], updatedAt: "2026-09-06T12:00:00.000Z", delegatedBy: "user_1" }, demo);
    const id = "01000000000000000000000001";
    const start = (players?: number) => command({ name: "start", type: 1, options: [{ name: "pack", type: 3, value: PACK }, { name: "mode", type: 3, value: "pairs" }, ...(players ? [{ name: "players", type: 4, value: players }] : [])] });
    // Too many chairs for the mode is refused before anything is made.
    expect(content(await call(signed(start(4)), d))).toContain("2 to 3");
    expect(content(await call(signed(start(2)), d))).toContain("started");
    // The host has seat one; the card says who sits where and which role each seat holds this unit.
    const run = (await guilds.guildRun(id))!;
    expect(run.seats).toEqual({ "1": { discordId: "1001", name: "Mira" } });
    const first = bot.posts[0]!.message as unknown as { embeds: Array<{ fields: Array<{ name: string; value: string }> }> };
    const table1 = first.embeds[0]!.fields.find((f) => f.name === "At the table")!.value;
    expect(table1).toContain("Seat 1: Mira");
    expect(table1).toContain("Seat 2: open");
    expect(table1).toMatch(/Thrower|Watcher/);
    // Nobody unseated presses the table; anyone takes an open chair, and then presses.
    expect(content(await call(signed(press(`rl:${id}:enter`, sam)), d))).toContain("whoever holds a seat");
    expect((await call(signed(press(`rl:${id}:seat:2`, sam)), d)).body["type"]).toBe(7);
    expect((await guilds.guildRun(id))!.seats?.["2"]).toEqual({ discordId: "1002", name: "Sam" });
    expect(content(await call(signed(press(`rl:${id}:seat:2`, { id: "1003", username: "kit", global_name: "Kit" })), d))).toContain("Sam");
    expect((await call(signed(press(`rl:${id}:enter`, sam)), d)).body["type"]).toBe(7);
    expect((await call(request("GET", `/api/public/runs/${id}/metrics?t=livetok`, { token: null }), d)).body).toMatchObject({ unit: 1 });
    // A seat is not the host: no ending, no undo, from that chair.
    expect(content(await call(signed(press(`rl:${id}:undo`, sam)), d))).toContain("whoever holds a seat");
    // Sam, unlinked, cannot follow; linked, Sam is at the session, as a viewer by following and a player by sitting.
    expect(content(await call(signed(press(`rl:${id}:follow`, sam)), d))).toContain("/link first");
    await guilds.connect("user_2", { discordUserId: "1002", name: "Sam", linkedAt: "2026-09-06T12:00:00.000Z" });
    expect((await call(signed(press(`rl:${id}:follow`, sam)), d)).body["type"]).toBe(7);
    expect((await call(request("GET", `/api/sessions/${id}`, { token: "guest" }), d)).body["session"]).toMatchObject({ id });
    // Leaving the chair frees it; the host keeps seat one.
    expect((await call(signed(press(`rl:${id}:unseat`, sam)), d)).body["type"]).toBe(7);
    expect((await guilds.guildRun(id))!.seats).toEqual({ "1": { discordId: "1001", name: "Mira" } });
    expect(content(await call(signed(press(`rl:${id}:unseat`)), d))).toContain("host keeps a seat");
    // A move that landed elsewhere between the read and the write is not built over.
    await store.appendEvents(id, "user_1", "2026-09-06T12:00:00.000Z", [{ t: "JournalWritten", at: "2026-09-06T12:00:00.000Z", id: "elsewhere", unit: 1, text: "from the app" }]);
    const original = store.appendEvents.bind(store);
    let attempts = 0;
    store.appendEvents = async (sid, author, at, events, opts) => {
      attempts += 1;
      // The first read sees the tail; a second move lands right before the write.
      if (attempts === 1) await original(sid, "user_1", at, [{ t: "JournalWritten", at, id: "raced", unit: 1, text: "raced" }]);
      return original(sid, author, at, events, opts);
    };
    expect(content(await call(signed(press(`rl:${id}:step`)), d))).toContain("The table moved");
    expect((await store.eventsAfter(id, 0)).filter((e) => e["t"] === "JournalWritten")).toHaveLength(2);
  });
});
