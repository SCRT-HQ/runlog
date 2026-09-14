/**
 * A deck, in about forty lines, for anyone who has not got one.
 *
 * Signs in with the CLI's own saved session, renewing it if it is close to
 * expiry the way `runlog`'s own `api()` does, then attaches as a deck,
 * watches the run it is told is held, and presses the primary on it
 * whenever Enter is struck. It is the smallest thing that exercises the
 * whole path, and it is what the plugin will do.
 */
import { credentials, renew } from "../packages/cli/src/account.ts";

const RENEW_MARGIN_MS = 60_000;
const base = process.env["RUNLOG_WS"] ?? "wss://runlog.scrthq.com";

async function tokenFromSession(): Promise<string> {
  const override = process.argv[2];
  if (override) return override;
  const creds = credentials();
  if (creds?.session) {
    const lapsing = !creds.session.expiresAt || Date.parse(creds.session.expiresAt) - Date.now() < RENEW_MARGIN_MS;
    return lapsing ? (await renew(creds.session)).accessToken : creds.session.accessToken;
  }
  console.error("Run `npm run runlog -- login` first: the socket needs a signed-in session, not a key.");
  process.exit(1);
}

const token = await tokenFromSession();
const ws = new WebSocket(`${base}/ws?token=${encodeURIComponent(token)}&as=deck`);
let run: string | null = null;
let seq = 0;

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
  if (m["t"] === "drove") console.log(m["ok"] ? "pressed" : `refused: ${String(m["say"] ?? "")}`);
});

process.stdin.on("data", () => {
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
