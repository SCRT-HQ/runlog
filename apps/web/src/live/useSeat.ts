import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Offer } from "../run/offer.ts";
import { apiBase } from "../sync/config.ts";
import { useApi } from "../sync/useApi.ts";
import { useAccount } from "../auth/Account.tsx";
import { openLive, socketUrl, type Gesture, type LiveSocket } from "../sync/socket.ts";
import type { SeatView } from "../sync/client.ts";
import { isSnapshot, type LiveSnapshot } from "./snapshot.ts";

/**
 * A run played from a seat.
 *
 * The same shape `usePublicRun` has, on the account rather than on a
 * link's token: the member route for the snapshot, a socket that rings
 * when the run moves, and a poll behind it. What it adds is the press: the
 * socket dials `as=seat`, watches the run, and sends what the strip
 * presses to whichever device is holding the run. A verdict comes back on
 * the same socket and is shown as it is.
 */

/** The snapshot with what the owner's page publishes beside it. */
export type SeatSnapshot = LiveSnapshot & { offer?: Offer };

/** The poll behind the socket: quick while the socket is down, a backstop while it is up. */
const POLL_MS = 6000;
const POLL_WITH_SOCKET_MS = 60_000;
/** How often a seat asks again whether the run's page is open; a page closing is not news the server can address to a seat. */
const HELD_ASK_MS = 30_000;

export interface Seat {
  /** Undefined while fetching; null when the run is not this account's to watch. */
  view: SeatView | null | undefined;
  snapshot: SeatSnapshot | null;
  /** Whether a device is holding the run, so a press has somewhere to land. */
  held: boolean;
  /** What came back from the last press, in the page's own words. */
  note: string | null;
  stale: boolean;
  /** The latest gesture from the table: what the host handed out, and what follows. */
  gesture: Gesture | null;
  press: (p: { press: string; move?: string; answer?: Record<string, unknown> }) => void;
}

export function useSeat(id: string): Seat {
  const base = apiBase();
  const api = useApi();
  const account = useAccount();
  const [view, setView] = useState<SeatView | null | undefined>(undefined);
  const [stale, setStale] = useState(false);
  const [held, setHeld] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const socketRef = useRef<LiveSocket | null>(null);
  /** The press waiting on a verdict. A verdict for an older one is about a press nobody is still looking at. */
  const pressed = useRef<string | null>(null);

  useEffect(() => {
    if (!api || !base || account.status !== "signed-in") return;
    let live = true;
    let busy = false;
    const read = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await api.watchAsSeat(id);
        if (!live) return;
        setView(next.found ? next : null);
        setStale(false);
      } catch {
        if (live) setStale(true);
      } finally {
        busy = false;
      }
    };
    void read();
    let socketOpen = false;
    let lastRead = Date.now();
    const poll = window.setInterval(() => {
      if (Date.now() - lastRead >= (socketOpen ? POLL_WITH_SOCKET_MS : POLL_MS)) {
        lastRead = Date.now();
        void read();
      }
    }, POLL_MS);
    const socket = openLive({
      url: async () => `${socketUrl(base, await account.getAccessToken())}&as=seat`,
      onChanged: (changed) => {
        if (changed.id !== id) return;
        lastRead = Date.now();
        void read();
        // A change is a device writing, which is a device holding it.
        setHeld(true);
      },
      onState: (open) => {
        socketOpen = open;
        if (open) {
          lastRead = Date.now();
          void read();
          socket.askHeld(id);
        } else setHeld(false);
      },
      onHeld: (h) => {
        if (h.id === id) setHeld(h.held);
      },
      // A seat is at the table, so it hears what the table hears: the
      // page above draws whichever of these it has words for.
      onGesture: (g) => {
        if (g.id === id) setGesture(g);
      },
      onDrove: (verdict) => {
        if (verdict.ref !== pressed.current) return;
        pressed.current = null;
        setNote(verdict.ok ? null : (verdict.say ?? "That press did not land."));
      },
    });
    socket.watch(id);
    socketRef.current = socket;
    const asking = window.setInterval(() => socket.askHeld(id), HELD_ASK_MS);
    return () => {
      live = false;
      window.clearInterval(poll);
      window.clearInterval(asking);
      socket.close();
      socketRef.current = null;
    };
  }, [api, base, id, account]);

  const snapshot = useMemo<SeatSnapshot | null>(() => {
    const raw = view?.snapshot?.snapshot;
    return isSnapshot(raw) ? (raw as SeatSnapshot) : null;
  }, [view]);

  const press = useCallback(
    (p: { press: string; move?: string; answer?: Record<string, unknown> }) => {
      const seq = snapshot?.offer?.seq;
      const socket = socketRef.current;
      if (seq === undefined || !socket) {
        setNote("The run is not open right now.");
        return;
      }
      setNote(null);
      const ref = `seat-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
      pressed.current = ref;
      if (!socket.press({ run: id, seq, ref, ...p })) setNote("The line to the run is down.");
    },
    [id, snapshot],
  );

  return { view, snapshot, held, note, stale, gesture, press };
}
