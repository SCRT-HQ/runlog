import { presentationSnapshotKey, type PresentationSnapshotV1 } from "@runlog/themes";
import { SyncError } from "../../sync/client.ts";
import type { LookApi, LookPublishOutcome, PublicLookAnswer } from "../../sync/lookApi.ts";
import { retryDelay, THEME_RETRY } from "../sync/reconcile.ts";
import type { LocalLookChannel, LookChannelStore, LookChannelUpdate } from "./channelStore.ts";

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
  /**
   * `keyGood` is true when the stored read key is known to open the link: made or relinked
   * here, or read back from the server since this publisher started or last moved the link.
   */
  readonly onState: (state: LookPublishState, channel: LocalLookChannel | null, keyGood: boolean) => void;
  /** A widget's read of the link by its key, to check a stored key still opens it. Without it every stored key is taken as good. */
  readonly readLook?: (readKey: string) => Promise<PublicLookAnswer>;
  /**
   * False in a tab that waits for another tab of this browser to stop publishing: it sends
   * only what its own actions owe, and otherwise says what the stored record says. Default true.
   */
  readonly leading?: boolean;
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
  /** This tab publishes for the browser from now on. */
  lead(): void;
  /** Resolves once no publish and no action is in flight. */
  idle(): Promise<void>;
  stop(): void;
}

type Change = (stored: LocalLookChannel | null) => LocalLookChannel | null | undefined;
type Fields = Partial<Pick<LocalLookChannel, "revision" | "publishedKey" | "readKey" | "elsewhere">>;

/** The stored record is still the link and the secret a publish was sent with. */
const sameHold = (stored: LocalLookChannel, held: LocalLookChannel) => stored.id === held.id && stored.secret === held.secret;
const sameLink = (stored: LocalLookChannel, held: LocalLookChannel) => stored.id === held.id;

/**
 * Sends the look this device applies to its theme link.
 *
 * One look at a time, the newest: an Apply waits a second for the next,
 * a failure waits on the theme sync schedule, and a stop ends everything,
 * including what an answer arriving afterwards would have written. The
 * record is shared by every tab of this browser, so each publish starts
 * from the stored record and each answer changes only its own fields.
 * One tab leads and sends each Apply; the others send only the first
 * look after a link is made or moved there. The stored read key is read
 * back from the server before it is handed out, and cleared when it no
 * longer opens the link.
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
  let leading = deps.leading ?? true;
  /** An action here made or moved the link, so this tab sends its look even while another tab leads. */
  let owed = false;
  /** The read key this publisher last found to open the link, and the one it is reading now. */
  let checked: string | null = null;
  let checking: string | null = null;
  /** Failed stored-key checks in a row, other than a plain "gone", and the retry they are waiting on. */
  let verifyFailures = 0;
  let verifyRetry: unknown = null;
  /**
   * The key a failed check is waiting to retry: held past the moment `checking` clears, so a second,
   * unforced call this same tick (another caller notices the same unchecked key) does not also count
   * as a failure and race the retry schedule ahead of itself.
   */
  let verifyPendingKey: string | null = null;
  const actions = new Set<Promise<unknown>>();

  const keyGood = () => channel !== null && channel.readKey !== null && (deps.readLook === undefined || channel.readKey === checked);
  const report = (next: LookPublishState) => {
    if (stopped) return;
    state = next;
    deps.onState(next, channel, keyGood());
  };
  const resting = (): LookPublishState =>
    channel === null
      ? { kind: "none" }
      : channel.elsewhere
        ? { kind: "elsewhere" }
        : channel.revision > 0
          ? { kind: "following" }
          : { kind: "not-published" };
  /** Waiting to send: the widgets keep the last look, or have none yet. */
  const waiting = (): LookPublishState => ({ kind: channel !== null && channel.revision > 0 ? "offline" : "not-published" });

  const reload = async (): Promise<LocalLookChannel | null> => {
    const loaded = await deps.store.load();
    if (!stopped) channel = loaded;
    return loaded;
  };
  /** One transaction on the stored record. Runs even once stopped: the store is this account's alone. */
  const write = async (change: Change): Promise<LookChannelUpdate> => {
    const out = await deps.store.update(change);
    if (!stopped) channel = out.value;
    return out;
  };
  /** Changes only `fields`, and only while the stored record is still the link `held` names. False once stopped. */
  const patch = async (held: LocalLookChannel, fields: (stored: LocalLookChannel) => Fields | undefined): Promise<boolean> => {
    if (stopped) return false;
    const out = await write((stored) => {
      if (stored === null || !sameHold(stored, held)) return undefined;
      const changed = fields(stored);
      return changed === undefined ? undefined : { ...stored, ...changed };
    });
    return out.written && !stopped;
  };
  const forget = (id: string) => write((stored) => (stored?.id === id ? null : undefined));

  const clearRetry = () => {
    if (retry !== null) clearTimer(retry);
    retry = null;
  };
  const clearVerifyRetry = () => {
    if (verifyRetry !== null) clearTimer(verifyRetry);
    verifyRetry = null;
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
    if (stopped) return;
    failures += 1;
    report(waiting());
    if (failures < THEME_RETRY.tries) later(retryDelay(failures));
  };

  const once = async (): Promise<void> => {
    if (stopped) return;
    // Another tab may have made, moved, relinked or forgotten the link since this one last looked.
    const current = await reload();
    if (stopped) return;
    if (current === null) {
      owed = false;
      // There is no link after all, or another tab revoked it; a revoke the server reported stays said.
      if (state.kind !== "none" && state.kind !== "gone") report(resting());
      return;
    }
    if (current.readKey !== null && current.readKey !== checked) void verify(current);
    if (current.elsewhere) {
      owed = false;
      if (state.kind !== "elsewhere") report(resting());
      return;
    }
    if (!leading && !owed) {
      // Another tab of this browser publishes: this one only says what the record says.
      const rest = resting();
      if (rest.kind !== state.kind) report(rest);
      return;
    }
    const snapshot = deps.snapshot();
    const key = presentationSnapshotKey(snapshot);
    if (current.publishedKey === key) {
      failures = 0;
      owed = false;
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
    if (stopped) return;
    switch (out.kind) {
      case "ok": {
        failures = 0;
        stales = 0;
        owed = false;
        const revision = out.revision;
        // A newer revision stored by another tab is not overwritten; this look is sent again on it.
        if (await patch(current, (stored) => (stored.revision < revision ? { revision, publishedKey: key } : undefined)))
          report({ kind: "following" });
        else again = true;
        return;
      }
      case "stale": {
        // Another tab of this device published first: send this look on its revision.
        stales += 1;
        const revision = out.revision;
        await patch(current, (stored) => (stored.revision < revision ? { revision } : undefined));
        if (stales < STALE_ROUNDS) again = true;
        else failed();
        return;
      }
      case "not-publisher":
        // A tab here may have taken the link back meanwhile; only the secret this was sent with is refused.
        if (await patch(current, () => ({ elsewhere: true }))) {
          owed = false;
          report({ kind: "elsewhere" });
          // The device that took it may have made a new link since: read the key here again.
          if (channel !== null) void verify(channel, true);
        } else again = true;
        return;
      case "gone":
        owed = false;
        await forget(current.id);
        if (stopped) return;
        if (channel === null) report({ kind: "gone" });
        else again = true;
        return;
      case "rate-limited":
        report(waiting());
        later(out.retryAfterMs);
        return;
      case "rejected":
        // A look this build made that the server will not take is a fault here, not something a retry mends.
        console.warn("theme link: the server refused a look", out.code);
        owed = false;
        report(waiting());
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
        try {
          await once();
        } catch {
          // The record could not be read or kept here: wait and try again like any failure.
          failed();
        }
      } while (again && !stopped);
    })().finally(() => {
      running = null;
    });
  };

  /** Keeps an action in view of `idle`, so the provider closes the store only after it lands. */
  const track = <T>(work: Promise<T>): Promise<T> => {
    actions.add(work);
    void work.finally(() => actions.delete(work)).catch(() => {});
    return work;
  };

  /**
   * Reads the link by the stored key. A key that no longer opens it (another device made a
   * new link, or the link was revoked) is cleared from the record, so no address is made
   * with it and New link is offered; a read that fails leaves the key unchecked.
   */
  const verify = (held: LocalLookChannel, again = false): Promise<void> =>
    track(
      (async () => {
        const key = held.readKey;
        const read = deps.readLook;
        if (stopped || read === undefined || key === null || checking === key || (!again && (checked === key || verifyPendingKey === key)))
          return;
        checking = key;
        try {
          const answer = await read(key);
          if (stopped) return;
          verifyFailures = 0;
          verifyPendingKey = null;
          clearVerifyRetry();
          if (answer.kind !== "gone") {
            const was = keyGood();
            checked = key;
            if (keyGood() !== was) report(state);
            return;
          }
          if (checked === key) checked = null;
          // Only the key that was read, and only on this link: another tab may have made a new one meanwhile.
          await write((stored) =>
            stored !== null && stored.id === held.id && stored.readKey === key ? { ...stored, readKey: null } : undefined,
          );
          report(state);
        } catch {
          // Offline, a server error, or a throttle, not a plain "gone": the key stays unchecked, and this
          // retries it on the theme sync schedule, bounded like any other retry.
          if (stopped) return;
          verifyFailures += 1;
          clearVerifyRetry();
          if (verifyFailures < THEME_RETRY.tries) {
            verifyPendingKey = key;
            verifyRetry = setTimer(() => {
              verifyRetry = null;
              void verify(held, true);
            }, retryDelay(verifyFailures));
          } else {
            verifyPendingKey = null;
          }
        } finally {
          checking = null;
        }
      })(),
    );

  return {
    async start() {
      try {
        await reload();
      } catch {
        failed();
        return;
      }
      if (stopped) return;
      report(resting());
      if (channel === null) return;
      void verify(channel);
      if (leading && !channel.elsewhere) kick();
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
    create() {
      return track(
        (async (): Promise<LookActionResult> => {
          if (stopped) return "error";
          try {
            await reload();
          } catch {
            return "error";
          }
          if (channel !== null) {
            // Another tab made one already: this device has its link.
            report(resting());
            if (!channel.elsewhere) kick();
            return "ok";
          }
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
          // Kept even if the account changed meanwhile: the link exists on the server either way.
          try {
            await write(() => next);
          } catch {
            return "error";
          }
          if (stopped) return "ok";
          checked = out.readKey;
          owed = true;
          report({ kind: "not-published" });
          // The first look goes at once, from this tab: the link is not ready until it lands.
          kick();
          return "ok";
        })(),
      );
    },
    takeOver(id) {
      return track(
        (async (): Promise<LookActionResult> => {
          if (stopped) return "error";
          let out;
          try {
            out = await deps.api.transfer(id);
          } catch {
            return "error";
          }
          if (out.kind === "plan") return "plan";
          if (out.kind === "gone") {
            try {
              await forget(id);
            } catch {
              return "gone";
            }
            if (channel === null) report({ kind: "gone" });
            return "gone";
          }
          const { secret, channel: summary } = out;
          try {
            // Only the device that made or relinked a link knows its read key: keep the stored one if it is this link.
            await write((stored) => ({
              schemaVersion: 1,
              id,
              secret,
              readKey: stored?.id === id ? stored.readKey : null,
              revision: summary.revision,
              publishedKey: null,
            }));
          } catch {
            return "error";
          }
          if (stopped) return "ok";
          failures = 0;
          stales = 0;
          owed = true;
          // A key kept from before may have been replaced while another device held the link.
          checked = null;
          report(resting());
          if (channel !== null) void verify(channel);
          kick();
          return "ok";
        })(),
      );
    },
    relink() {
      return track(
        (async (): Promise<LookActionResult> => {
          if (stopped) return "error";
          let loaded: LocalLookChannel | null;
          try {
            loaded = await reload();
          } catch {
            return "error";
          }
          if (loaded === null) return "error";
          const current = loaded;
          let out;
          try {
            out = await deps.api.relink(current.id);
          } catch {
            return "error";
          }
          if (out.kind === "plan") return "plan";
          if (out.kind === "gone") {
            try {
              await forget(current.id);
            } catch {
              return "gone";
            }
            if (channel === null) report({ kind: "gone" });
            return "gone";
          }
          const readKey = out.readKey;
          try {
            // The read key belongs to the link, not the secret: kept even if a tab moved the secret meanwhile.
            await write((stored) => (stored !== null && sameLink(stored, current) ? { ...stored, readKey } : undefined));
          } catch {
            return "error";
          }
          if (!stopped) checked = readKey;
          report(resting());
          return "ok";
        })(),
      );
    },
    revoke(id) {
      return track(
        (async (): Promise<boolean> => {
          if (stopped) return false;
          let revoked: boolean;
          try {
            revoked = await deps.api.revoke(id);
          } catch {
            return false;
          }
          try {
            if ((await forget(id)).written) report({ kind: "none" });
          } catch {
            // The server has forgotten it; the next publish here finds it gone and clears the record.
          }
          return revoked;
        })(),
      );
    },
    lead() {
      if (stopped || leading) return;
      leading = true;
      failures = 0;
      stales = 0;
      kick();
    },
    async idle() {
      while (running || actions.size > 0) await Promise.allSettled([running, ...actions]);
    },
    stop() {
      stopped = true;
      if (debounce !== null) clearTimer(debounce);
      debounce = null;
      clearRetry();
      clearVerifyRetry();
    },
  };
}
