import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../auth/Account.tsx";
import { markPackSync } from "../storage/db.ts";
import { syncBus } from "./bus.ts";
import { createApi } from "./client.ts";
import { apiBase, setSyncEnabled, syncEnabled } from "./config.ts";
import { openLive, socketUrl, type LiveSocket } from "./socket.ts";
import { lastActive } from "../run/active.ts";
import { createEngine, storageDb, type Engine, type Report, type SyncStatus } from "./engine.ts";

/**
 * Sync, as the app sees it.
 *
 * Available only where all three are true: there is an API (a hosted build
 * with a client id), somebody is signed in, and this device's switch has
 * not been turned off. Anywhere else, disk, the public page, a player who
 * has not signed in or who switched this device off, the provider renders
 * its children and nothing else, so the rest of the app never has to ask
 * twice.
 *
 * When it is on, a pass runs at sign-in, when the tab comes back, when the
 * network does, and two seconds after the last local change. While this
 * device has a run open and the tab is visible it also holds a socket to
 * the server that says "changed" when another device moves, and syncs at
 * once; a poll every ten seconds stands in while the socket is down, and
 * every minute as a backstop while it is up.
 */

export interface Sync {
  /** There is an API and an account; the switch may be turned on. */
  available: boolean;
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  status: "off" | SyncStatus;
  last: Report | null;
  syncNow: () => void;
  setPackSync: (id: string, on: boolean) => Promise<void>;
  /** Pass a gesture to everyone watching a run; nothing happens when the socket is down. */
  gesture: (id: string, kind: string, data?: Record<string, unknown>) => void;
}

const off: Sync = {
  available: false,
  enabled: false,
  setEnabled: () => {},
  status: "off",
  last: null,
  syncNow: () => {},
  setPackSync: async () => {},
  gesture: () => {},
};

export const SyncContext = createContext<Sync>(off);

export function useSync(): Sync {
  return useContext(SyncContext);
}

const SETTLE_MS = 2000;
/** How often an open run asks after the others when nothing else will tell it. */
const POLL_MS = 10_000;
/** …and when the socket is up and would say so: a backstop, not the mechanism. */
const POLL_WITH_SOCKET_MS = 60_000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const base = apiBase();
  const available = base !== undefined && account.status === "signed-in";

  // The account's address, told to the server on sign-in rather than only
  // from the profile page: an invitation is checked against it.
  useEffect(() => {
    if (!base || account.status !== "signed-in" || !account.user.email) return;
    void createApi(base, account.getAccessToken)
      .putProfile({ email: account.user.email })
      .catch(() => {});
    // Once per sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, account.status === "signed-in" ? account.user.id : null]);

  const [enabled, setEnabledState] = useState(() => syncEnabled());
  const [status, setStatus] = useState<Sync["status"]>("off");
  const [last, setLast] = useState<Report | null>(null);
  /** The open socket, for gestures sent from the run view. */
  const socketRef = useRef<LiveSocket | null>(null);
  const engineRef = useRef<Engine | null>(null);

  const active = available && enabled;

  useEffect(() => {
    if (!active || account.status !== "signed-in" || !base) {
      engineRef.current = null;
      setStatus("off");
      return;
    }
    let live = true;
    let settle: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      let engine = engineRef.current;
      if (!engine) {
        engine = createEngine(createApi(base, account.getAccessToken), await storageDb());
        if (!live) return;
        engineRef.current = engine;
      }
      setStatus("syncing");
      const report = await engine.sync();
      if (!live) return;
      setLast(report);
      setStatus(report.status);
    };

    const soon = () => {
      clearTimeout(settle);
      settle = setTimeout(() => void run(), SETTLE_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };

    const onWake = () => void run();

    /**
     * The doorbell: one socket while the page is visible and a run is
     * open, watching that run. A "changed" for it is a sync now; the poll
     * slows to a backstop while the socket is up and takes over when it
     * is not. Nothing here decides anything: a nudge is a fetch.
     */
    let socket: LiveSocket | null = null;
    let socketOpen = false;
    let lastPoll = Date.now();
    const watchCurrent = () => socket?.watch(lastActive()?.runId ?? null);
    const openSocket = () => {
      if (socket || !lastActive() || document.visibilityState !== "visible") return;
      socket = openLive({
        url: async () => socketUrl(base, await account.getAccessToken()),
        onChanged: (changed) => {
          if (changed.id === lastActive()?.runId) void run();
        },
        onGesture: (g) => syncBus.emit({ t: "gesture", id: g.id, kind: g.kind, data: g.data, ...(g.from ? { from: g.from } : {}), at: g.at }),
        onState: (open) => {
          socketOpen = open;
        },
      });
      socketRef.current = socket;
      watchCurrent();
    };
    const closeSocket = () => {
      socket?.close();
      socket = null;
      socketRef.current = null;
      socketOpen = false;
    };
    const onVisibleSocket = () => {
      if (document.visibilityState === "visible") openSocket();
      else closeSocket();
    };

    void run();
    openSocket();
    const poll = setInterval(() => {
      if (document.visibilityState !== "visible" || !lastActive()) return;
      // A run opened since: the socket should exist, and watch it.
      openSocket();
      watchCurrent();
      const due = socketOpen ? POLL_WITH_SOCKET_MS : POLL_MS;
      if (Date.now() - lastPoll < due - 500) return;
      lastPoll = Date.now();
      void run();
    }, POLL_MS);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("visibilitychange", onVisibleSocket);
    const unsubscribe = syncBus.subscribe((news) => {
      if (news.t === "localChange") {
        soon();
        watchCurrent();
      }
    });

    return () => {
      live = false;
      clearTimeout(settle);
      clearInterval(poll);
      closeSocket();
      unsubscribe();
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("visibilitychange", onVisibleSocket);
    };
  }, [active, account, base]);

  const value = useMemo<Sync>(
    () =>
      available
        ? {
            available,
            enabled,
            setEnabled: (on) => {
              setSyncEnabled(on);
              setEnabledState(on);
            },
            status: active ? status : "off",
            last,
            syncNow: () => {
              if (engineRef.current) {
                setStatus("syncing");
                void engineRef.current.sync().then((r) => {
                  setLast(r);
                  setStatus(r.status);
                });
              }
            },
            setPackSync: async (id, on) => {
              await markPackSync(id, on);
              syncBus.localChange("pack", id);
            },
            gesture: (id, kind, data) => {
              socketRef.current?.gesture(id, kind, data);
            },
          }
        : off,
    [available, enabled, active, status, last],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
