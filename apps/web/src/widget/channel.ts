import { LOOK_READ_KEY_PATTERN, parsePublicLook, type PresentationSnapshotV1, type PublicLookV1 } from "@runlog/themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiBase } from "../sync/config.ts";
import { fetchPublicLook, type PublicLookAnswer } from "../sync/lookApi.ts";
import type { WidgetRoute } from "./route.ts";

/**
 * A widget following a theme link: the look another device publishes,
 * read by the key in this widget's address.
 *
 * Read on start, when the run's socket rings or opens again after a drop,
 * and once a minute behind it. The last good look of this same link is kept
 * in this browser, so a slow or offline start shows it rather than
 * nothing; no other link's look is ever shown, and an answer that does
 * not read changes nothing on the page.
 */
export type FollowedLook =
  | { readonly kind: "waiting" }
  | { readonly kind: "look"; readonly snapshot: PresentationSnapshotV1; readonly revision: number; readonly from: "server" | "cache" }
  | { readonly kind: "gone" };

export const LOOK_POLL_MS = 60_000;
const PREFIX = "runlog.look.v1:";
const INDEX = "runlog.look.v1";
const KEEP = 4;
const MAX_CHARS = 8192;
const WAITING: FollowedLook = Object.freeze({ kind: "waiting" });
const GONE: FollowedLook = Object.freeze({ kind: "gone" });

export type LookCacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storageOf(storage: LookCacheStorage | null | undefined): LookCacheStorage | null {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
function indexOf(target: LookCacheStorage): string[] {
  try {
    const value = JSON.parse(target.getItem(INDEX) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((k): k is string => typeof k === "string" && LOOK_READ_KEY_PATTERN.test(k)) : [];
  } catch {
    return [];
  }
}

/** The last good look this browser kept for this one link, or null. Nothing kept for any other key is read. */
export function readCachedLook(readKey: string, storage?: LookCacheStorage | null): PublicLookV1 | null {
  const target = storageOf(storage);
  if (target === null || !LOOK_READ_KEY_PATTERN.test(readKey)) return null;
  try {
    const text = target.getItem(PREFIX + readKey);
    if (text === null || text.length > MAX_CHARS) return null;
    const parsed = parsePublicLook(JSON.parse(text));
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

/** Keep this link's look, and forget all but the few links read most recently. */
export function writeCachedLook(readKey: string, look: PublicLookV1, storage?: LookCacheStorage | null): void {
  const target = storageOf(storage);
  if (target === null || !LOOK_READ_KEY_PATTERN.test(readKey)) return;
  try {
    target.setItem(PREFIX + readKey, JSON.stringify(look));
    const kept = [readKey, ...indexOf(target).filter((k) => k !== readKey)];
    for (const old of kept.slice(KEEP)) target.removeItem(PREFIX + old);
    target.setItem(INDEX, JSON.stringify(kept.slice(0, KEEP)));
  } catch {
    // A full or blocked storage keeps nothing; the next start reads the server.
  }
}

export function forgetCachedLook(readKey: string, storage?: LookCacheStorage | null): void {
  const target = storageOf(storage);
  if (target === null) return;
  try {
    target.removeItem(PREFIX + readKey);
    target.setItem(INDEX, JSON.stringify(indexOf(target).filter((k) => k !== readKey)));
  } catch {
    // Nothing kept to forget.
  }
}

/** What a widget wears before its first read: this link's cached look, or nothing yet. A key of the wrong shape is a link that does not work. */
export function bootFollowedLook(readKey: string, storage?: LookCacheStorage | null): FollowedLook {
  if (!LOOK_READ_KEY_PATTERN.test(readKey)) return GONE;
  const cached = readCachedLook(readKey, storage);
  return cached ? Object.freeze({ kind: "look", snapshot: cached.snapshot, revision: cached.revision, from: "cache" }) : WAITING;
}

export interface LookFollowerDeps {
  readonly readKey: string;
  readonly fetchLook: (readKey: string) => Promise<PublicLookAnswer>;
  readonly onChange: (look: FollowedLook) => void;
  readonly storage?: LookCacheStorage | null;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}
export interface LookFollower {
  start(): void;
  ring(): void;
  stop(): void;
  idle(): Promise<void>;
}

export function createLookFollower(deps: LookFollowerDeps): LookFollower {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const readable = LOOK_READ_KEY_PATTERN.test(deps.readKey);
  // The cache is read on start, not here, so what is shown first is what the cache holds then.
  let current: FollowedLook = WAITING;
  let stopped = false;
  let timer: unknown = null;
  let running: Promise<void> | null = null;
  let again = false;

  const show = (next: FollowedLook) => {
    if (stopped) return;
    current = next;
    deps.onChange(next);
  };
  const read = async () => {
    let answer: PublicLookAnswer;
    try {
      answer = await deps.fetchLook(deps.readKey);
    } catch {
      // Offline, or an answer that does not read: what is shown stays.
      return;
    }
    if (stopped) return;
    if (answer.kind === "gone") {
      forgetCachedLook(deps.readKey, deps.storage);
      show(GONE);
      return;
    }
    if (answer.kind === "unpublished") return;
    if (current.kind === "look" && current.from === "server" && answer.look.revision < current.revision) return;
    // The same revision again, as most polls are: nothing to write and nothing new to show.
    if (current.kind === "look" && current.from === "server" && answer.look.revision === current.revision) return;
    writeCachedLook(deps.readKey, answer.look, deps.storage);
    show(Object.freeze({ kind: "look", snapshot: answer.look.snapshot, revision: answer.look.revision, from: "server" }));
  };
  const kick = () => {
    if (stopped || !readable) return;
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      do {
        again = false;
        await read();
      } while (again && !stopped);
    })().finally(() => {
      running = null;
    });
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimer(() => {
      timer = null;
      kick();
      schedule();
    }, LOOK_POLL_MS);
  };

  return {
    start() {
      if (stopped) return;
      current = bootFollowedLook(deps.readKey, deps.storage);
      deps.onChange(current);
      if (!readable) return;
      kick();
      schedule();
    },
    ring: kick,
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    async idle() {
      while (running) await running;
    },
  };
}

/** The line a widget page follows its link on, where it holds one: see `usePublicRun`. */
export interface FollowOnSocket {
  readonly readKey: string;
  readonly onLook: () => void;
  readonly onReopen: () => void;
}

/**
 * The link's look for a widget page, `look` undefined when its address
 * follows no link. A pin or a named built-in wins over a link, so then the
 * link is not read at all. The follower reads on start and once a minute;
 * `socket` is what a widget on the run's live link hands its one socket,
 * so a ring or a reopen reads again. A widget with no live link opens no
 * socket for the look and relies on the minute's read.
 */
export function useFollowedLook(route: Pick<WidgetRoute, "ch" | "pin" | "theme">): {
  readonly look: FollowedLook | undefined;
  readonly socket: FollowOnSocket | undefined;
} {
  const ch = route.pin === undefined && !route.theme ? route.ch : undefined;
  // The key the look belongs to is kept beside it, so a render after the key
  // changes never shows the old key's look.
  const [state, setState] = useState<{ readonly ch: string; readonly look: FollowedLook } | null>(() =>
    ch === undefined ? null : { ch, look: bootFollowedLook(ch) },
  );
  const follower = useRef<LookFollower | null>(null);
  const base = apiBase();
  const followable = ch !== undefined && base !== undefined && LOOK_READ_KEY_PATTERN.test(ch);
  useEffect(() => {
    if (ch === undefined || base === undefined || !LOOK_READ_KEY_PATTERN.test(ch)) return;
    const current = createLookFollower({
      readKey: ch,
      fetchLook: (key) => fetchPublicLook(base, key),
      onChange: (look) => setState({ ch, look }),
    });
    follower.current = current;
    current.start();
    return () => {
      current.stop();
      if (follower.current === current) follower.current = null;
    };
  }, [ch, base]);
  const socket = useMemo<FollowOnSocket | undefined>(
    () =>
      followable && ch !== undefined
        ? { readKey: ch, onLook: () => follower.current?.ring(), onReopen: () => follower.current?.ring() }
        : undefined,
    [followable, ch],
  );
  const look = ch === undefined ? undefined : state !== null && state.ch === ch ? state.look : bootFollowedLook(ch);
  return { look, socket };
}
