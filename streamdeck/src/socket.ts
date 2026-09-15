import type { Account } from "./session.ts";
import { bearer as realBearer } from "./session.ts";
import type { Store } from "./store.ts";
import { attachedRun } from "./state.ts";

export interface WireDeps {
  WebSocket: typeof WebSocket;
  fetch: typeof fetch;
  bearer: (a: Account) => Promise<string | null>;
  now: () => number;
  random: () => number;
}

export interface Wire {
  connect(): void;
  disconnect(): void;
  press(p: { press: string; move?: string; answer?: Record<string, unknown> }): string | null;
}

/** The app's own rule: a second, doubling, capped at half a minute, with a little jitter. */
function backoffMs(attempt: number, random: () => number): number {
  return Math.min(30_000, 1000 * 2 ** attempt) * (0.8 + random() * 0.4);
}

/**
 * One socket to Runlog, as a deck.
 *
 * It attaches signed in and names no run; the server pushes the held
 * list, the store picks, and this watches whichever it picked so the
 * doorbell rings here too. A ring is a fetch of the snapshot on the
 * signed-in route, which is where the offer is. A press names the run
 * and the offer's `seq`, so the page can refuse one the run has moved
 * past.
 *
 * The account may be a getter, resolved again on every connect and every
 * fetch: the address is a setting the streamer can change, and the one that
 * counts is the one it reads when the streamer presses Connect.
 */
export function openWire(account: Account | (() => Account), store: Store, deps: WireDeps = realDeps()): Wire {
  let socket: WebSocket | null = null;
  let wanted = false;
  let attempt = 0;
  let watching: string | null = null;
  const currentAccount = (): Account => (typeof account === "function" ? account() : account);

  const fetchSnapshot = async (run: string) => {
    const acct = currentAccount();
    const token = await deps.bearer(acct);
    if (!token) return;
    try {
      const res = await deps.fetch(`${acct.apiBase}/api/sessions/${encodeURIComponent(run)}/snapshot`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.ok) store.dispatch({ t: "snapshot", snapshot: (await res.json()) as never });
    } catch {
      /* the next ring tries again */
    }
  };

  const follow = () => {
    const run = attachedRun(store.state);
    if (run === watching || !socket) return;
    watching = run;
    if (run) {
      socket.send(JSON.stringify({ t: "watch", id: run }));
      void fetchSnapshot(run);
    }
  };
  store.subscribe(follow);

  const open = async () => {
    if (!wanted) return;
    const acct = currentAccount();
    const token = await deps.bearer(acct);
    if (!token) {
      store.dispatch({ t: "session", state: "expired" });
      return;
    }
    store.dispatch({ t: "socket", state: "connecting" });
    const wsBase = acct.apiBase.replace(/^http/, "ws");
    const ws = new deps.WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}&as=deck`);
    socket = ws;
    ws.onopen = () => {
      attempt = 0;
      watching = null;
      store.dispatch({ t: "socket", state: "open" });
      ws.send(JSON.stringify({ t: "hello" }));
    };
    ws.onmessage = (e) => {
      let m: unknown;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (typeof m !== "object" || m === null) return;
      const msg = m as Record<string, unknown>;
      if (msg["t"] === "runs" && Array.isArray(msg["runs"])) {
        const runs = msg["runs"].filter(
          (r): r is { id: string } => typeof r === "object" && r !== null && typeof (r as Record<string, unknown>)["id"] === "string",
        );
        store.dispatch({ t: "runs", runs: runs as never, any: msg["any"] === true });
      } else if (msg["t"] === "changed" && msg["id"] === watching && watching) void fetchSnapshot(watching);
      else if (msg["t"] === "drove" && typeof msg["ref"] === "string")
        store.dispatch({
          t: "drove",
          ref: msg["ref"],
          ok: msg["ok"] === true,
          ...(typeof msg["say"] === "string" ? { say: msg["say"] } : {}),
          ...(typeof msg["seq"] === "number" ? { seq: msg["seq"] } : {}),
        });
    };
    ws.onclose = () => {
      // A close arriving after a newer socket took over - Reconnect closes and
      // dials again, and a real close is asynchronous - is about a socket
      // nobody is using. Letting it through would report the live one as down
      // and then open a third.
      if (socket !== null && socket !== ws) return;
      socket = null;
      store.dispatch({ t: "socket", state: "closed" });
      if (wanted) setTimeout(() => void open(), backoffMs(attempt++, deps.random));
    };
  };

  return {
    connect() {
      wanted = true;
      void open();
    },
    disconnect() {
      wanted = false;
      socket?.close();
    },
    press(p) {
      const run = attachedRun(store.state);
      const seq = store.state.snapshot?.offer?.seq;
      if (!run || seq === undefined || !socket) return null;
      const ref = `sd-${deps.now().toString(36)}-${Math.floor(deps.random() * 1e6).toString(36)}`;
      socket.send(JSON.stringify({ t: "drive", run, seq, ref, ...p }));
      return ref;
    },
  };
}

function realDeps(): WireDeps {
  return {
    WebSocket: globalThis.WebSocket,
    fetch: (i, o) => fetch(i, o),
    bearer: realBearer,
    now: () => Date.now(),
    random: () => Math.random(),
  };
}
