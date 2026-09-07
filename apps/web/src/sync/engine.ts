import type { StoredLicense, StoredPack, StoredRun, SyncState } from "../storage/db.ts";
import { diff, type Entry } from "./diff.ts";
import { hashText } from "./hash.ts";
import type { RunEvent } from "@runlog/engine";
import { SyncError, type Api, type RemoteLicense, type RemotePack, type SessionEvent, type SyncFailure } from "./client.ts";
import { merge, nameFrom, pendingEvents, stampIds, tailSeq } from "./log.ts";
import { syncBus } from "./bus.ts";
import { settlePurchases } from "./purchases.ts";
import { loadPackText } from "@runlog/rules-schema";

/**
 * The engine: manifest, diff, act, record.
 *
 * One pass looks like this. Ask the server what it holds. Runs are
 * sessions with an append-only log: send what this device made and has not
 * had numbered, take back what the server has past what this device saw,
 * and fold the two together — nothing here is ever replaced whole. Packs
 * travel only where the player turned the pack's own switch on, so
 * untoggled text never leaves, and never a sealed copy at all; license keys
 * always, because a key is what lets the next device open the file the
 * player already paid for. Diff those two. Push, pull, delete and purge as
 * the plan says, telling the app about anything that arrived.
 *
 * Nothing here throws. Every failure becomes a status the header can show,
 * which is the same rule storage keeps: losing sync is survivable, losing
 * the session is not. One pass at a time; a request to sync while a pass is
 * running is remembered and honored once, afterwards.
 */

export type SyncStatus = "idle" | "syncing" | "synced" | SyncFailure;

export interface Report {
  status: SyncStatus;
  pushed: number;
  pulled: number;
  at: string;
}

/** What the engine needs from storage. Narrow, so a test can fake it with Maps. */
export interface SyncDb {
  listRuns(): Promise<StoredRun[]>;
  loadRun(runId: string): Promise<StoredRun | null>;
  saveRun(run: StoredRun): Promise<unknown>;
  purgeRun(runId: string): Promise<unknown>;
  listAllPacks(): Promise<StoredPack[]>;
  loadPack(id: string): Promise<StoredPack | null>;
  savePack(pack: StoredPack): Promise<unknown>;
  purgePack(id: string): Promise<unknown>;
  listLicenses(): Promise<StoredLicense[]>;
  saveLicense(license: StoredLicense): Promise<unknown>;
  purgeLicense(packId: string): Promise<unknown>;
  listSyncState(): Promise<SyncState[]>;
  putSyncState(state: SyncState): Promise<unknown>;
  forgetSyncState(id: string): Promise<unknown>;
}

export interface Engine {
  sync(): Promise<Report>;
  /** The last report, for the header. */
  last(): Report | null;
}

/** What a license's fingerprint covers: the key and what it was matched on. */
const licenseText = (l: { key: string; ref?: string; title?: string }) =>
  JSON.stringify([l.key, l.ref ?? "", l.title ?? ""]);

export function createEngine(api: Api, db: SyncDb, now: () => string = () => new Date().toISOString()): Engine {
  let inFlight: Promise<Report> | null = null;
  let again = false;
  let last: Report | null = null;

  async function fingerprint<T extends { updatedAt: string; deletedAt?: string }>(
    items: T[],
    id: (x: T) => string,
    text: (x: T) => string,
    known: Map<string, SyncState>,
  ): Promise<Entry[]> {
    const out: Entry[] = [];
    for (const item of items) {
      const key = id(item);
      const seen = known.get(key);
      // A fingerprint the server confirmed for this very stamp is still good;
      // hashing a long log on every pass is the cost this saves.
      const hash =
        seen && seen.updatedAt === item.updatedAt && !item.deletedAt ? seen.hash : await hashText(text(item));
      out.push({
        id: key,
        updatedAt: item.updatedAt,
        hash,
        ...(item.deletedAt ? { deletedAt: item.deletedAt } : {}),
      });
    }
    return out;
  }

  async function pass(): Promise<Report> {
    const at = now();
    let pushed = 0;
    let pulled = 0;
    try {
      const remote = await api.manifest();
      const known = new Map((await db.listSyncState()).map((s) => [s.id, s]));

      // ---- sessions: send my outbox, take their tail ----
      const runs = await db.listRuns();
      const remoteSessions = new Map(remote.sessions.map((s) => [s.id, s]));
      const pulledRuns: string[] = [];
      const seen = new Set<string>();
      // One run's trouble is that run's: the rest of the pass goes on, and
      // the pass says so at the end. Only the connection and the sign-in
      // stop everything.
      let troubled = false;

      for (const local of runs) {
        seen.add(local.runId);
        const theirs = remoteSessions.get(local.runId);
        try {

        if (local.deletedAt) {
          // Forgotten here. Tell the server once, then let the tombstone go.
          if (theirs && !theirs.deletedAt) await api.deleteSession(local.runId);
          await db.purgeRun(local.runId);
          await db.forgetSyncState(local.runId);
          continue;
        }
        if (theirs?.deletedAt) {
          // Ended for everyone by its owner: this copy goes too.
          await db.purgeRun(local.runId);
          await db.forgetSyncState(local.runId);
          pulledRuns.push(local.runId);
          continue;
        }

        const stamped = await stampIds(local.runId, local.events as RunEvent[]);
        const pending = pendingEvents(stamped);
        const before = tailSeq(stamped);
        let incoming: SessionEvent[] = [];
        let role = local.role;
        let members = local.members;
        let shared = local.shared;

        if (!theirs) {
          // The server has never heard of it, or no longer lists it for
          // this account: start the session with the whole log, numbered
          // afresh. If another device got there first, take its tail and
          // send what is still pending against it.
          const created = await api.createSession({
            id: local.runId,
            packId: local.packId,
            packVersion: local.packVersion,
            ...(local.packTitle ? { packTitle: local.packTitle } : {}),
            ...(nameFrom(stamped) ? { name: nameFrom(stamped)! } : {}),
            events: stamped,
          });
          if (created) {
            incoming = created.events;
            role = "owner";
            pushed += 1;
          } else {
            const got = await api.getSession(local.runId, 0);
            if (got) {
              incoming = got.events;
              members = got.members;
              shared = got.session.shared;
              const merged = merge(stamped, incoming as unknown as RunEvent[]);
              const still = pendingEvents(merged);
              if (still.length > 0) incoming = [...incoming, ...(await api.appendEvents(local.runId, still)).appended];
            }
          }
        } else {
          // How far the server's log goes: the manifest's word, or the
          // append's, whichever is later.
          let serverTail = theirs?.seq ?? 0;
          if (pending.length > 0) {
            const sent = await api.appendEvents(local.runId, pending);
            incoming = sent.appended;
            serverTail = Math.max(serverTail, sent.seq);
            pushed += 1;
            const renamed = pending.some((e) => e.t === "RunRenamed");
            if (renamed) await api.patchSession(local.runId, { name: nameFrom(stamped) ?? "" });
          }
          // Anything numbered past what was here and not among what just
          // came back is somebody else's: fetch from where this device was.
          if (serverTail > before + incoming.length) {
            const got = await api.getSession(local.runId, before);
            if (got) {
              incoming = [...incoming, ...got.events];
              members = got.members;
              shared = got.session.shared;
            }
          }
          if (theirs) role = theirs.role;
        }

        const merged = merge(stamped, incoming as unknown as RunEvent[]);
        const changed =
          merged.length !== local.events.length || tailSeq(merged) !== before || stamped !== local.events || members !== local.members || role !== local.role || shared !== local.shared;
        if (changed) {
          await db.saveRun({
            ...local,
            events: merged,
            seq: tailSeq(merged),
            ...(role ? { role } : {}),
            ...(members ? { members } : {}),
            ...(typeof shared === "boolean" ? { shared } : {}),
            updatedAt: theirs && theirs.updatedAt > local.updatedAt ? theirs.updatedAt : local.updatedAt,
          });
          const mine = new Set(pending.map((e) => e.id));
          if (incoming.some((e) => e.seq > before && !mine.has(e.id))) {
            pulledRuns.push(local.runId);
            pulled += 1;
          }
        }
        } catch (error) {
          if (error instanceof SyncError && (error.kind === "offline" || error.kind === "unauthorized")) throw error;
          troubled = true;
        }
      }

      // Sessions the server has that this device does not: take them whole.
      for (const theirs of remote.sessions) {
        if (seen.has(theirs.id) || theirs.deletedAt) continue;
        const got = await api.getSession(theirs.id, 0);
        if (!got) continue;
        await db.saveRun({
          runId: theirs.id,
          packId: theirs.packId,
          packVersion: theirs.packVersion,
          ...(theirs.packTitle ? { packTitle: theirs.packTitle } : {}),
          events: got.events,
          updatedAt: theirs.updatedAt,
          seq: tailSeq(got.events as unknown as RunEvent[]),
          role: theirs.role,
          members: got.members,
        });
        pulledRuns.push(theirs.id);
        pulled += 1;
      }
      syncBus.pulled("run", pulledRuns);

      // ---- packs: only the ones the player said may travel ----
      // A sealed copy is left out even from the tombstones: the server is
      // not told it exists, and `forget` purges it outright for that reason.
      // And the server's row under the same id — a free copy of the same
      // pack, or the tombstone of one — is about that copy, not this one:
      // it must neither overwrite nor purge what was bought, so it is left
      // out of the plan while the sealed copy is on the shelf.
      const allPacks = await db.listAllPacks();
      const sealedHere = new Set(allPacks.filter((p) => p.sealed && !p.deletedAt).map((p) => p.id));
      const packs = allPacks.filter((p) => !p.sealed && (p.sync || p.deletedAt));
      const byPack = new Map(packs.map((p) => [p.id, p]));
      const packPlan = diff(
        await fingerprint(packs, (p) => p.id, (p) => p.source, known),
        remote.packs.filter((p) => !sealedHere.has(p.id)),
      );
      const remotePacks = new Map(remote.packs.map((p) => [p.id, p]));

      for (const id of packPlan.push) {
        const local = byPack.get(id)!;
        const hash = await hashText(local.source);
        const remotePack: RemotePack = {
          id,
          title: local.title,
          version: local.version,
          format: local.format,
          filename: local.filename,
          importedAt: local.importedAt,
          updatedAt: local.updatedAt,
          hash,
          source: local.source,
          ...(local.origin ? { origin: local.origin } : {}),
          ...(local.catalog ? { catalog: local.catalog } : {}),
          // The license's word rides with the text, so the server can hand
          // the pack to a stranger with a live link only where it may.
          shareable: shareableOf(local),
        };
        const entry = await pushOnce(
          () => api.putPack(remotePack, known.get(id)?.hash),
          remotePacks.get(id),
          local.updatedAt,
        );
        if (entry) {
          await db.putSyncState({ id, kind: "pack", updatedAt: entry.updatedAt, hash: entry.hash });
          pushed += 1;
        } else {
          packPlan.pull.push(id);
        }
      }
      const pulledPacks: string[] = [];
      for (const id of packPlan.pull) {
        const theirs = await api.getPack(id);
        if (!theirs) continue;
        const existing = await db.loadPack(id);
        await db.savePack({
          id: theirs.id,
          title: theirs.title,
          version: theirs.version,
          source: theirs.source,
          format: theirs.format,
          filename: theirs.filename,
          importedAt: theirs.importedAt,
          updatedAt: theirs.updatedAt,
          // Arriving from the account means it was chosen to travel.
          sync: existing?.sync ?? true,
          // Where it came from travels with it, so this device can offer
          // the catalog's newer version too; a copy from before that was
          // recorded keeps whatever this device knew.
          ...((theirs.origin ?? existing?.origin) ? { origin: theirs.origin ?? existing!.origin! } : {}),
          ...((theirs.catalog ?? existing?.catalog) ? { catalog: theirs.catalog ?? existing!.catalog! } : {}),
        });
        await db.putSyncState({ id, kind: "pack", updatedAt: theirs.updatedAt, hash: theirs.hash });
        pulledPacks.push(id);
        pulled += 1;
      }
      for (const id of packPlan.forgetLocal) {
        await db.purgePack(id);
        await db.forgetSyncState(id);
        pulledPacks.push(id);
      }
      for (const id of packPlan.deleteRemote) {
        await api.deletePack(id);
        await db.purgePack(id);
        await db.forgetSyncState(id);
      }
      for (const id of packPlan.purge) {
        await db.purgePack(id);
        await db.forgetSyncState(id);
      }
      syncBus.pulled("pack", pulledPacks);

      // ---- licenses: small, and always ----
      const licenses = await db.listLicenses();
      const byLicense = new Map(licenses.map((l) => [l.packId, l]));
      const licensePlan = diff(
        await fingerprint(licenses, (l) => l.packId, licenseText, known),
        remote.licenses ?? [],
      );
      const remoteLicenses = new Map((remote.licenses ?? []).map((l) => [l.id, l]));

      for (const id of licensePlan.push) {
        const local = byLicense.get(id)!;
        const hash = await hashText(licenseText(local));
        const remoteLicense: RemoteLicense = {
          id,
          key: local.key,
          ...(local.ref ? { ref: local.ref } : {}),
          ...(local.title ? { title: local.title } : {}),
          updatedAt: local.updatedAt,
          hash,
        };
        const entry = await pushOnce(
          () => api.putLicense(remoteLicense, known.get(id)?.hash),
          remoteLicenses.get(id),
          local.updatedAt,
        );
        if (entry) {
          await db.putSyncState({ id, kind: "license", updatedAt: entry.updatedAt, hash: entry.hash });
          pushed += 1;
        } else {
          licensePlan.pull.push(id);
        }
      }
      const pulledLicenses: string[] = [];
      for (const id of licensePlan.pull) {
        const theirs = await api.getLicense(id);
        if (!theirs) continue;
        await db.saveLicense({
          packId: theirs.id,
          key: theirs.key,
          ...(theirs.ref ? { ref: theirs.ref } : {}),
          ...(theirs.title ? { title: theirs.title } : {}),
          updatedAt: theirs.updatedAt,
        });
        await db.putSyncState({ id, kind: "license", updatedAt: theirs.updatedAt, hash: theirs.hash });
        pulledLicenses.push(id);
        pulled += 1;
      }
      for (const id of licensePlan.forgetLocal) {
        await db.purgeLicense(id);
        await db.forgetSyncState(id);
        pulledLicenses.push(id);
      }
      for (const id of licensePlan.deleteRemote) {
        await api.deleteLicense(id);
        await db.purgeLicense(id);
        await db.forgetSyncState(id);
      }
      for (const id of licensePlan.purge) {
        await db.purgeLicense(id);
        await db.forgetSyncState(id);
      }
      syncBus.pulled("license", pulledLicenses);

      // ---- purchases: bought copies this device does not have yet ----
      const arrived = await settlePurchases(api, db);
      if (arrived.length > 0) {
        pulled += arrived.length;
        syncBus.pulled("pack", arrived);
      }

      return { status: troubled ? "error" : "synced", pushed, pulled, at };
    } catch (error) {
      const kind: SyncFailure = error instanceof SyncError ? error.kind : "error";
      return { status: kind, pushed, pulled, at };
    }
  }

  /**
   * One push, and one re-think on a conflict: the server holds a version
   * this pass did not know about. If theirs is newer, pulling is the right
   * answer; if mine is, push again without the precondition.
   */
  async function pushOnce(
    put: () => Promise<Entry>,
    theirs: Entry | undefined,
    mineUpdatedAt: string,
  ): Promise<Entry | null> {
    try {
      return await put();
    } catch (error) {
      if (!(error instanceof SyncError) || error.kind !== "conflict") throw error;
      const server = error.entry ?? theirs;
      if (server && server.updatedAt > mineUpdatedAt) return null;
      return put();
    }
  }

  return {
    sync() {
      if (inFlight) {
        again = true;
        return inFlight;
      }
      inFlight = (async () => {
        let report = await pass();
        while (again) {
          again = false;
          report = await pass();
        }
        last = report;
        inFlight = null;
        return report;
      })();
      return inFlight;
    },
    last: () => last,
  };
}

/** The storage module, in the shape the engine wants. */
export async function storageDb(): Promise<SyncDb> {
  const db = await import("../storage/db.ts");
  return {
    listRuns: db.listRuns,
    loadRun: db.loadRun,
    saveRun: db.saveRun,
    purgeRun: db.purgeRun,
    listAllPacks: db.listAllPacks,
    loadPack: db.loadPack,
    savePack: db.savePack,
    purgePack: db.purgePack,
    listLicenses: db.listLicenses,
    saveLicense: db.saveLicense,
    purgeLicense: db.purgeLicense,
    listSyncState: db.listSyncState,
    putSyncState: db.putSyncState,
    forgetSyncState: db.forgetSyncState,
  };
}

/** Whether a pack's license lets its text travel to other people; unknown reads as no. */
function shareableOf(pack: StoredPack): boolean {
  try {
    const parsed = loadPackText(pack.source, pack.format);
    return parsed.ok ? parsed.pack.license.redistributable !== false : false;
  } catch {
    return false;
  }
}
