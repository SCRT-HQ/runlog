/**
 * The doorbell.
 *
 * A device with a run open holds one socket to the server and says which
 * session it is watching. When another device changes that session the
 * server sends one line — "changed, seq 12" — and this device syncs at
 * once instead of at the next poll. Nothing else travels here: the moves
 * still come down the same authenticated fetch as before, so a socket
 * that lies can only cause a fetch that finds nothing new.
 *
 * Sockets close for a hundred reasons — a laptop lid, a tunnel, a deploy —
 * so this one reconnects with a backoff that starts at a second and stops
 * growing at half a minute, re-sends its watch on every open, and fetches
 * a fresh token for each attempt, since the last one may have expired
 * while the lid was shut. Polling carries on underneath at a slower pace,
 * and takes over entirely while the socket is down.
 */

export interface Changed {
  t: "changed";
  id: string;
  seq: number;
}

export interface LiveSocket {
  /** Watch this session; re-sent after every reconnect. Null to watch nothing. */
  watch(id: string | null): void;
  /** Pass a gesture to everyone watching a run; false when the line is down (a gesture is not worth queueing). */
  gesture(id: string, kind: string, data?: Record<string, unknown>): boolean;
  close(): void;
  readonly open: boolean;
}

/**
 * Something happening at a table that is not a move: dice in the air, a
 * step opened, a card turned. Passed on by the server to everyone watching
 * and kept nowhere; `kind` is a short word the app gives meaning to.
 */
export interface Gesture {
  t: "gesture";
  id: string;
  kind: string;
  data: Record<string, unknown>;
  from?: string;
  at: string;
}

export function parseGesture(data: unknown): Gesture | null {
  if (typeof data !== "string") return null;
  try {
    const m = JSON.parse(data) as Record<string, unknown>;
    if (m && m["t"] === "gesture" && typeof m["id"] === "string" && typeof m["kind"] === "string" && typeof m["at"] === "string") {
      const payload = m["data"];
      return {
        t: "gesture",
        id: m["id"],
        kind: m["kind"],
        data: typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {},
        ...(typeof m["from"] === "string" ? { from: m["from"] } : {}),
        at: m["at"],
      };
    }
  } catch {
    // Not ours.
  }
  return null;
}

export interface LiveOptions {
  /** Where to connect, with a fresh token each time. */
  url: () => Promise<string>;
  onChanged: (changed: Changed) => void;
  /** A gesture from someone at the table of a watched run. */
  onGesture?: (gesture: Gesture) => void;
  /** Called with true on open and false on close, for the poll to adjust. */
  onState?: (open: boolean) => void;
  /** The constructor, so a test can hand in a pretend socket. */
  WebSocketImpl?: typeof WebSocket;
  /** For tests: how long to wait, instead of real time. */
  wait?: (ms: number, fn: () => void) => () => void;
}

/** The socket's address: the API's base with `/api` swapped for `/ws`, over wss, the token in the query. */
export function socketUrl(apiBase: string, token: string): string {
  const url = new URL(apiBase.replace(/\/api\/?$/, "/ws"));
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.searchParams.set("token", token);
  return url.href;
}

/** Seconds to wait before the nth reconnect: 1, 2, 4, … capped at 30, with a little jitter. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + random() * 0.4));
}

/** What came down the socket, if it is the one thing we understand. */
export function parseChanged(data: unknown): Changed | null {
  if (typeof data !== "string") return null;
  try {
    const m = JSON.parse(data) as Record<string, unknown>;
    if (m && m["t"] === "changed" && typeof m["id"] === "string" && typeof m["seq"] === "number") return { t: "changed", id: m["id"], seq: m["seq"] };
  } catch {
    // Not ours.
  }
  return null;
}

const realWait = (ms: number, fn: () => void) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

export function openLive(opts: LiveOptions): LiveSocket {
  const Impl = opts.WebSocketImpl ?? (typeof WebSocket !== "undefined" ? WebSocket : undefined);
  const wait = opts.wait ?? realWait;
  let socket: WebSocket | null = null;
  let watching: string | null = null;
  let attempt = 0;
  let closed = false;
  let open = false;
  let cancelWait: (() => void) | null = null;

  const setOpen = (value: boolean) => {
    if (open === value) return;
    open = value;
    opts.onState?.(value);
  };

  const send = () => {
    if (open && socket && watching) socket.send(JSON.stringify({ t: "watch", id: watching }));
  };

  const connect = async () => {
    if (closed || !Impl) return;
    let url: string;
    try {
      url = await opts.url();
    } catch {
      // No token: nobody to be. Try again later; the account may come back.
      schedule();
      return;
    }
    if (closed) return;
    let ws: WebSocket;
    try {
      ws = new Impl(url);
    } catch {
      schedule();
      return;
    }
    socket = ws;
    ws.onopen = () => {
      if (ws !== socket) return;
      attempt = 0;
      setOpen(true);
      send();
    };
    ws.onmessage = (event) => {
      const data = (event as MessageEvent).data;
      const changed = parseChanged(data);
      if (changed) {
        opts.onChanged(changed);
        return;
      }
      const gesture = parseGesture(data);
      if (gesture) opts.onGesture?.(gesture);
    };
    ws.onclose = () => {
      if (ws !== socket) return;
      socket = null;
      setOpen(false);
      schedule();
    };
    ws.onerror = () => {
      // The close that follows does the work.
    };
  };

  const schedule = () => {
    if (closed) return;
    cancelWait?.();
    cancelWait = wait(backoffMs(attempt), () => {
      cancelWait = null;
      attempt += 1;
      void connect();
    });
  };

  void connect();

  return {
    gesture(id, kind, data = {}) {
      if (!open || !socket) return false;
      socket.send(JSON.stringify({ t: "gesture", id, kind, data }));
      return true;
    },
    watch(id) {
      if (watching === id) return;
      watching = id;
      send();
    },
    close() {
      closed = true;
      cancelWait?.();
      cancelWait = null;
      const s = socket;
      socket = null;
      setOpen(false);
      try {
        s?.close();
      } catch {
        // Already gone.
      }
    },
    get open() {
      return open;
    },
  };
}
