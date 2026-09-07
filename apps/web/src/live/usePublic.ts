import { useEffect, useMemo, useState } from "react";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { reduce, type RunEvent } from "@runlog/engine";
import { apiBase } from "../sync/config.ts";
import { publicRun, publicSocketUrl, type PublicRun } from "../sync/client.ts";
import { openLive, type Gesture } from "../sync/socket.ts";
import { isSnapshot, snapshotOf, type LiveSnapshot } from "./snapshot.ts";

/**
 * A run read by its live link, kept fresh.
 *
 * The one place the live page and a widget by token both go: the public
 * route with the link's token, a socket opened with the same token that
 * rings when the run moves, and a poll behind it. What comes back is
 * turned into a snapshot here — reduced from the log where the pack was
 * handed over, taken as is where the owner's device wrote it — so
 * everything downstream draws one shape.
 */
export interface PublicState {
  /** Undefined while fetching; null when the link is not open. */
  got: PublicRun | null | undefined;
  pack: Pack | null;
  snapshot: LiveSnapshot | null;
  /** The last read failed; what is shown may be behind. */
  stale: boolean;
  /** No address to ask: a copy of the app with no API. */
  offline: boolean;
  /** The latest gesture from the table: dice in the air, and what follows. */
  gesture: Gesture | null;
}

/** The poll behind the socket: quick while the socket is down, a backstop while it is up. */
const POLL_MS = 6000;
const POLL_WITH_SOCKET_MS = 60_000;

export function usePublicRun(id: string, token: string): PublicState {
  const base = apiBase();
  const [got, setGot] = useState<PublicRun | null | undefined>(undefined);
  const [stale, setStale] = useState(false);
  const [pack, setPack] = useState<Pack | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);

  useEffect(() => {
    if (!base) return;
    let live = true;
    let busy = false;
    const read = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await publicRun(base, id, token);
        if (!live) return;
        setGot(next);
        setStale(false);
        if (next && next.access === "full" && next.pack) {
          const source = next.pack;
          setPack((prev) => {
            if (prev) return prev;
            const parsed = loadPackText(source.source, source.format);
            return parsed.ok ? parsed.pack : null;
          });
        }
      } catch {
        if (live) setStale(true);
      } finally {
        busy = false;
      }
    };
    void read();
    // The socket is the mechanism; the poll is what stands in while it is
    // down, and a once-a-minute check while it is up.
    let socketOpen = false;
    let lastRead = Date.now();
    const poll = window.setInterval(() => {
      const due = socketOpen ? POLL_WITH_SOCKET_MS : POLL_MS;
      if (Date.now() - lastRead >= due) {
        lastRead = Date.now();
        void read();
      }
    }, POLL_MS);
    const socket = openLive({
      url: async () => publicSocketUrl(base, id, token),
      onChanged: (changed) => {
        if (changed.id === id) {
          lastRead = Date.now();
          void read();
        }
      },
      onState: (open) => {
        socketOpen = open;
        // Back up: whatever moved while the socket was down is read now.
        if (open) {
          lastRead = Date.now();
          void read();
        }
      },
      onGesture: (g) => {
        if (g.id === id) setGesture(g);
      },
    });
    socket.watch(id);
    return () => {
      live = false;
      window.clearInterval(poll);
      socket.close();
    };
  }, [base, id, token]);

  const snapshot = useMemo<LiveSnapshot | null>(() => {
    if (!got) return null;
    if (got.access === "full" && pack && got.events) {
      const events = got.events as RunEvent[];
      return snapshotOf(pack, reduce(pack, events), events);
    }
    if (got.access === "snapshot" && got.snapshot && isSnapshot(got.snapshot.snapshot)) return got.snapshot.snapshot;
    return null;
  }, [got, pack]);

  return { got, pack, snapshot, stale, offline: !base, gesture };
}
