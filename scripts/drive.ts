/**
 * A deck, in about forty lines, for anyone who has not got one.
 *
 * Signs in with the CLI's own saved session through `runlog`'s own `bearer`,
 * which renews it when it is close to expiry and writes the renewed session
 * back, since the issuer retires the old refresh token on every renewal.
 * Then it attaches as a deck, watches the run it is told is held, and
 * presses the primary on it whenever Enter is struck. It is the smallest
 * thing that exercises the whole path, and it is what the plugin will do.
 */
import { bearer, credentials } from "../packages/cli/src/account.ts";

// RUNLOG_WS=wss://runlog.dev.scrthq.com reaches the dev copy instead.
const base = process.env["RUNLOG_WS"] ?? "wss://runlog.scrthq.com";

async function tokenFromSession(): Promise<string> {
  const override = process.argv[2];
  if (override) return override;
  const creds = credentials();
  if (creds?.session) return bearer(creds);
  console.error("Run `npm run runlog -- login` first: the socket needs a signed-in session, not a key.");
  process.exit(1);
}

const token = await tokenFromSession();
const ws = new WebSocket(`${base}/ws?token=${encodeURIComponent(token)}&as=deck`);
let run: string | null = null;
let seq = 0;
let connected = true;

ws.addEventListener("close", () => {
  connected = false;
  console.log("socket closed");
});
ws.addEventListener("error", (event) => console.log((event as ErrorEvent).message ?? String(event)));

ws.addEventListener("message", (event) => {
  const m = JSON.parse(String(event.data)) as Record<string, unknown>;
  if (m["t"] === "runs") {
    const runs = m["runs"] as Array<{ id: string; name?: string; packTitle?: string }>;
    console.log(runs.length === 0 ? "No run open." : runs.map((r) => `${r.id} ${r.name ?? ""} (${r.packTitle ?? ""})`).join("\n"));
    if (!run) {
      const picked = (process.env["RUN"] && runs.find((r) => r.id === process.env["RUN"])) || runs[0];
      run = picked?.id ?? null;
      if (run) ws.send(JSON.stringify({ t: "watch", id: run }));
    }
  }
  if (m["t"] === "changed" && m["id"] === run) seq = m["seq"] as number;
  if (m["t"] === "drove") {
    // The verdict carries the run's new seq where the page sent one, and
    // it arrives before the doorbell does: taking it here is what lets a
    // second press follow the first without waiting for the sync to settle.
    if (typeof m["seq"] === "number") seq = m["seq"];
    console.log(m["ok"] ? "pressed" : `refused: ${String(m["say"] ?? "")}`);
  }
});

process.stdin.on("data", () => {
  if (!connected) return console.log("not connected");
  if (!run) return console.log("nothing to press");
  ws.send(
    JSON.stringify({
      t: "drive",
      run,
      seq: Number(process.env["SEQ"] ?? seq),
      ref: `cli-${Date.now()}`,
      press: "primary",
    }),
  );
});
