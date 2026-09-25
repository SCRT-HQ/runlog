import { presentationSnapshotKey, type PresentationSnapshotV1 } from "@runlog/themes";
import { SyncError } from "../../sync/client.ts";
import type { LookApi, LookPublishOutcome } from "../../sync/lookApi.ts";
import { retryDelay, THEME_RETRY } from "../sync/reconcile.ts";
import type { LocalLookChannel, LookChannelStore } from "./channelStore.ts";

/** How long after the last Apply the look goes out: a string of quick Applies sends one publish. */
export const LOOK_PUBLISH_DEBOUNCE_MS = 1000;
/** Stale answers in a row before this device stops racing another tab and waits like any failure. */
const STALE_ROUNDS = 3;

export type LookPublishState =
  | { readonly kind: "none" }
  | { readonly kind: "not-published" }
  | { readonly kind: "following" }
  | { readonly kind: "offline" }
  | { readonly kind: "elsewhere" }
  | { readonly kind: "gone" };
export type LookActionResult = "ok" | "plan" | "full" | "gone" | "error";
export interface LookPublisherDeps {
  readonly api: LookApi;
  readonly store: LookChannelStore;
  /** The look applied now, System already resolved. */
  readonly snapshot: () => PresentationSnapshotV1;
  readonly onState: (state: LookPublishState, channel: LocalLookChannel | null) => void;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}
export interface LookPublisher {
  start(): Promise<void>;
  applied(): void;
  create(): Promise<LookActionResult>;
  takeOver(id: string): Promise<LookActionResult>;
  relink(): Promise<LookActionResult>;
  revoke(id: string): Promise<boolean>;
  idle(): Promise<void>;
  stop(): void;
}

/**
 * Sends the look this device applies to its theme link.
 *
 * One look at a time, the newest: an Apply waits a second for the next,
 * a failure waits on the theme sync schedule, and a stop ends everything,
 * including what an answer arriving afterwards would have written.
 */
export function createLookPublisher(deps: LookPublisherDeps): LookPublisher {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let channel: LocalLookChannel | null = null;
  let state: LookPublishState = { kind: "none" };
  let stopped = false;
  let debounce: unknown = null;
  let retry: unknown = null;
  let failures = 0;
  let stales = 0;
  let running: Promise<void> | null = null;
  let again = false;

  const report = (next: LookPublishState) => {
    if (stopped) return;
    state = next;
    deps.onState(next, channel);
  };
  const resting = (): LookPublishState =>
    channel === null ? { kind: "none" } : channel.revision > 0 ? { kind: "following" } : { kind: "not-published" };
  /** Store first, then memory: a record that could not be kept is not acted on. False once stopped. */
  const keep = async (next: LocalLookChannel | null): Promise<boolean> => {
    if (stopped) return false;
    if (next) await deps.store.save(next);
    else await deps.store.clear();
    if (stopped) return false;
    channel = next;
    return true;
  };
  const clearRetry = () => {
    if (retry !== null) clearTimer(retry);
    retry = null;
  };
  const later = (ms: number) => {
    clearRetry();
    if (stopped) return;
    retry = setTimer(() => {
      retry = null;
      kick();
    }, ms);
  };
  const failed = () => {
    failures += 1;
    report({ kind: channel !== null && channel.revision > 0 ? "offline" : "not-published" });
    if (failures < THEME_RETRY.tries) later(retryDelay(failures));
  };

  const once = async (): Promise<void> => {
    const current = channel;
    if (stopped || current === null || state.kind === "elsewhere") return;
    const snapshot = deps.snapshot();
    const key = presentationSnapshotKey(snapshot);
    if (current.publishedKey === key) {
      failures = 0;
      report({ kind: "following" });
      return;
    }
    let out: LookPublishOutcome;
    try {
      out = await deps.api.publish({ id: current.id, secret: current.secret, base: current.revision, snapshot });
    } catch (error) {
      if (stopped) return;
      // Signed out, or the session is somebody else's now: the provider ends this publisher.
      if (error instanceof SyncError && error.kind === "unauthorized") return;
      failed();
      return;
    }
    if (stopped || channel !== current) return;
    switch (out.kind) {
      case "ok":
        failures = 0;
        stales = 0;
        if (await keep({ ...current, revision: out.revision, publishedKey: key })) report({ kind: "following" });
        return;
      case "stale":
        // Another tab of this device published first: send this look on its revision.
        stales += 1;
        if (!(await keep({ ...current, revision: out.revision }))) return;
        if (stales < STALE_ROUNDS) again = true;
        else failed();
        return;
      case "not-publisher":
        report({ kind: "elsewhere" });
        return;
      case "gone":
        if (await keep(null)) report({ kind: "gone" });
        return;
      case "rate-limited":
        later(out.retryAfterMs);
        return;
      case "rejected":
        // A look this build made that the server will not take is a fault here, not something a retry mends.
        console.warn("theme link: the server refused a look", out.code);
        report({ kind: current.revision > 0 ? "offline" : "not-published" });
        return;
    }
  };

  const kick = () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      do {
        again = false;
        await once();
      } while (again && !stopped);
    })().finally(() => {
      running = null;
    });
  };

  return {
    async start() {
      const loaded = await deps.store.load();
      if (stopped) return;
      channel = loaded;
      report(resting());
      if (loaded) kick();
    },
    applied() {
      if (stopped) return;
      if (debounce !== null) clearTimer(debounce);
      debounce = setTimer(() => {
        debounce = null;
        failures = 0;
        stales = 0;
        clearRetry();
        kick();
      }, LOOK_PUBLISH_DEBOUNCE_MS);
    },
    async create() {
      if (stopped) return "error";
      let out;
      try {
        out = await deps.api.create();
      } catch {
        return "error";
      }
      if (out.kind === "plan" || out.kind === "full") return out.kind;
      const next: LocalLookChannel = {
        schemaVersion: 1,
        id: out.channel.id,
        secret: out.secret,
        readKey: out.readKey,
        revision: 0,
        publishedKey: null,
      };
      if (!(await keep(next))) return "error";
      report({ kind: "not-published" });
      // The first look goes at once: the link is not ready until it lands.
      kick();
      return "ok";
    },
    async takeOver(id) {
      if (stopped) return "error";
      let out;
      try {
        out = await deps.api.transfer(id);
      } catch {
        return "error";
      }
      if (out.kind === "plan") return "plan";
      if (out.kind === "gone") {
        if (channel?.id === id && (await keep(null))) report({ kind: "gone" });
        return "gone";
      }
      // Only the device that made or relinked a link knows its read key.
      const readKey = channel?.id === id ? channel.readKey : null;
      const next: LocalLookChannel = {
        schemaVersion: 1,
        id,
        secret: out.secret,
        readKey,
        revision: out.channel.revision,
        publishedKey: null,
      };
      if (!(await keep(next))) return "error";
      failures = 0;
      stales = 0;
      // Clears "elsewhere" so the look below goes out.
      state = { kind: "none" };
      report(resting());
      kick();
      return "ok";
    },
    async relink() {
      const current = channel;
      if (stopped || current === null) return "error";
      let out;
      try {
        out = await deps.api.relink(current.id);
      } catch {
        return "error";
      }
      if (out.kind === "plan") return "plan";
      if (out.kind === "gone") {
        if (await keep(null)) report({ kind: "gone" });
        return "gone";
      }
      if (!(await keep({ ...current, readKey: out.readKey }))) return "error";
      report(state.kind === "elsewhere" ? state : resting());
      return "ok";
    },
    async revoke(id) {
      if (stopped) return false;
      let revoked: boolean;
      try {
        revoked = await deps.api.revoke(id);
      } catch {
        return false;
      }
      if (channel?.id === id && (await keep(null))) report({ kind: "none" });
      return revoked;
    },
    async idle() {
      while (running) await running;
    },
    stop() {
      stopped = true;
      if (debounce !== null) clearTimer(debounce);
      debounce = null;
      clearRetry();
    },
  };
}
