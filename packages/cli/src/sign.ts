import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { requireClaimed } from "./account.ts";
import {
  detectFormat,
  fingerprint,
  generateKeyPair,
  generateLicenseKey,
  seal,
  signPack,
  verifyPack,
} from "@runlog/rules-schema";

/**
 * Signing from the command line.
 *
 * A designer's release process is a script, so this has to work in one. Two
 * commands: make a key once, then sign on every release.
 *
 * The signature is written back into the pack rather than kept beside it. A
 * detached signature is a second file to lose, and the whole value here is
 * that a copy which turns up somewhere still carries its own proof.
 */

const RED = "[31m";
const GREEN = "[32m";
const YELLOW = "[33m";
const DIM = "[2m";
const RESET = "[0m";
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string, text: string) => (useColor ? `${code}${text}${RESET}` : text);

interface StoredKey {
  algorithm: string;
  publicKey: string;
  privateKey: string;
  fingerprint: string;
  createdAt: string;
}

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

export async function cmdKeygen(args: string[]): Promise<number> {
  const out = resolve(flag(args, "-o") ?? flag(args, "--out") ?? "runlog-key.json");
  if (existsSync(out)) {
    // Overwriting a signing key destroys every signature ever made with it,
    // silently and irreversibly. Never do it because a path was reused.
    console.error(paint(RED, `refusing to overwrite ${out}`));
    console.error(paint(DIM, "  a signing key cannot be recovered; delete it yourself if you mean to"));
    return 1;
  }

  const pair = await generateKeyPair();
  const key: StoredKey = {
    algorithm: "ecdsa-p256-sha256",
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    fingerprint: await fingerprint(pair.publicKey),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(out, `${JSON.stringify(key, null, 2)}\n`, "utf8");
  try {
    chmodSync(out, 0o600);
  } catch {
    // Windows and some filesystems do not do this. Not worth failing over.
  }

  console.log(`wrote ${out}`);
  console.log("");
  console.log(`  fingerprint  ${paint(GREEN, key.fingerprint)}`);
  console.log("");
  console.log(paint(DIM, "  Publish that fingerprint where your players will see it — a site, a"));
  console.log(paint(DIM, "  video, the back of the book. It is how anyone tells your packs from"));
  console.log(paint(DIM, "  a stranger's claiming to be you."));
  console.log("");
  console.log(paint(YELLOW, "  Keep this file private and backed up."));
  console.log(paint(DIM, "  Anyone who has it can sign as you. Lose it and you cannot sign again"));
  console.log(paint(DIM, "  under the same fingerprint — your players would have to learn a new one."));
  return 0;
}

/**
 * The signing key: `--key file.json`, or the file's contents in
 * `RUNLOG_SIGNING_KEY`, which is how a build server holds it — as a secret
 * in the environment, never as a file in the repository.
 */
export function loadKey(args: string[], env: NodeJS.ProcessEnv = process.env): { key: StoredKey; from: string } | { error: string } {
  const keyPath = flag(args, "--key") ?? flag(args, "-k");
  const fromEnv = env["RUNLOG_SIGNING_KEY"];
  if (!keyPath && !fromEnv) return { error: "no signing key: pass --key runlog-key.json, or set RUNLOG_SIGNING_KEY to the key file's contents" };
  const from = keyPath ?? "RUNLOG_SIGNING_KEY";
  let key: StoredKey;
  try {
    key = JSON.parse(keyPath ? readFileSync(resolve(keyPath), "utf8") : fromEnv!) as StoredKey;
  } catch {
    return { error: keyPath ? `could not read the key at ${keyPath}` : "RUNLOG_SIGNING_KEY is not the key file's JSON" };
  }
  if (typeof key !== "object" || key === null || !key.privateKey) return { error: `${from} has no private key in it` };
  return { key, from };
}

export async function cmdSign(args: string[]): Promise<number> {
  const input = args.filter((a) => !a.startsWith("-"))[0];
  if (!input) {
    console.error("usage: runlog sign <pack.yaml> --key runlog-key.json [--as \"Your Name\"]   (or RUNLOG_SIGNING_KEY in the environment)");
    return 2;
  }

  const held = loadKey(args);
  if ("error" in held) {
    console.error(paint(RED, held.error));
    return 1;
  }
  const { key } = held;
  // A named signature means an account stands behind the key. Refuse
  // otherwise, and say what to run.
  try {
    await requireClaimed(key.publicKey);
  } catch (error) {
    console.error(paint(RED, error instanceof Error ? error.message : String(error)));
    return 1;
  }

  const path = resolve(input);
  const text = readFileSync(path, "utf8");
  const format = detectFormat(path);
  const document = YAML.parse(text) as Record<string, unknown>;

  const signature = await signPack(document, key.privateKey, flag(args, "--as"));
  const signed = { ...document, signature };

  // Written back in the format it arrived in: an author who keeps YAML under
  // version control should not find it turned into JSON by signing it.
  writeFileSync(
    path,
    format === "json" ? `${JSON.stringify(signed, null, 2)}\n` : YAML.stringify(signed, { lineWidth: 90 }),
    "utf8",
  );

  console.log(`${paint(GREEN, "signed")} ${input}`);
  console.log(paint(DIM, `  fingerprint ${key.fingerprint}`));
  if (format === "yaml") {
    console.log(
      paint(DIM, "  note: rewriting the file drops comments; sign a copy if you keep them"),
    );
  }
  return 0;
}

/**
 * Stamp a copy with the buyer's name, and sign it.
 *
 * One command, because the two halves are only worth anything together. The
 * name goes inside the signed content, so editing it out breaks the signature:
 * a recipient is left choosing between a copy that names them and a copy that
 * visibly is not the author's release. A stamp without a signature is a line
 * of YAML anyone can delete, which is why doing that warns.
 *
 * Writes a new file rather than editing in place: a seller has one master and
 * produces many copies from it, and overwriting the master with one buyer's
 * name would be a bad afternoon.
 */
export async function cmdIssue(args: string[]): Promise<number> {
  const input = args.filter((a) => !a.startsWith("-"))[0];
  const to = flag(args, "--to");
  if (!input || !to) {
    console.error(
      'usage: runlog issue <pack.yaml> --to "Buyer Name" [--ref order-123] [--key key.json] [-o out.yaml]',
    );
    return 2;
  }

  const path = resolve(input);
  const text = readFileSync(path, "utf8");
  const format = detectFormat(path);
  const document = YAML.parse(text) as Record<string, unknown>;

  // Any signature on the master is about the master. This copy differs from
  // it, so that signature is void here whether or not a new one replaces it.
  const { signature: _old, ...base } = document;
  const stamped: Record<string, unknown> = {
    ...base,
    issue: {
      to,
      ...(flag(args, "--ref") ? { reference: flag(args, "--ref") } : {}),
      issuedAt: new Date().toISOString(),
    },
  };

  const keyGiven = Boolean(flag(args, "--key") ?? flag(args, "-k") ?? process.env["RUNLOG_SIGNING_KEY"]);
  let fingerprintText = "";
  if (keyGiven) {
    const held = loadKey(args);
    if ("error" in held) {
      console.error(paint(RED, held.error));
      return 1;
    }
    const { key } = held;
    try {
      await requireClaimed(key.publicKey);
    } catch (error) {
      console.error(paint(RED, error instanceof Error ? error.message : String(error)));
      return 1;
    }
    stamped.signature = await signPack(stamped, key.privateKey, flag(args, "--as"));
    fingerprintText = key.fingerprint;
  }

  // Sealing turns the copy into a binary the buyer cannot open in an editor,
  // and makes the file inert without the license key that came with it.
  const sealing = args.includes("--seal");
  const licenseKey = sealing ? (flag(args, "--license") ?? generateLicenseKey()) : null;

  const extension = sealing ? "rlpack" : format;
  const out = resolve(
    flag(args, "-o") ?? flag(args, "--out") ?? defaultIssueName(document, to, extension),
  );
  if (existsSync(out)) {
    console.error(paint(RED, `refusing to overwrite ${out}`));
    return 1;
  }

  if (licenseKey) {
    const bytes = await seal(stamped, licenseKey, {
      ...(flag(args, "--ref") ? { ref: flag(args, "--ref")! } : {}),
      ...(typeof stamped.title === "string" ? { title: stamped.title } : {}),
    });
    writeFileSync(out, bytes);
  } else {
    writeFileSync(
      out,
      format === "json" ? `${JSON.stringify(stamped, null, 2)}
` : YAML.stringify(stamped, { lineWidth: 90 }),
      "utf8",
    );
  }

  console.log(`${paint(GREEN, "issued")} ${out}`);
  console.log(paint(DIM, `  to ${to}${flag(args, "--ref") ? ` · ref ${flag(args, "--ref")}` : ""}`));
  if (keyGiven) {
    console.log(paint(DIM, `  signed · fingerprint ${fingerprintText}`));
    console.log(
      paint(DIM, "  the name is inside the signature, so removing it breaks verification"),
    );
  } else {
    console.log(paint(YELLOW, "  not signed"));
    console.log(
      paint(DIM, "  an unsigned stamp is one line of YAML anyone can delete. Pass --key to bind it."),
    );
  }
  if (licenseKey) {
    console.log("");
    console.log(`  license key  ${paint(GREEN, licenseKey)}`);
    console.log(paint(DIM, "  Send this with the file. Without it the copy will not open."));
    console.log("");
    console.log(paint(DIM, "  What sealing buys: the file is not YAML, so it cannot be opened in"));
    console.log(paint(DIM, "  an editor and stripped, and on its own it is inert. What it does"));
    console.log(paint(DIM, "  not buy: anyone determined enough to read their own browser can"));
    console.log(paint(DIM, "  still reach the rules, because the app has to show them to play."));
  } else {
    console.log("");
    console.log(paint(DIM, "  This marks the copy. It does not restrict it — the buyer can still"));
    console.log(paint(DIM, "  pass the file on, and it will play. What changes is that it, and"));
    console.log(paint(DIM, "  every log exported from it, says whose copy it was."));
    console.log(paint(DIM, "  Add --seal to distribute a sealed copy that needs a license key."));
  }
  return 0;
}

/** `long-kiln-1.0.0-nate-ferrell.yaml` — one file per buyer, findable later. */
function defaultIssueName(document: Record<string, unknown>, to: string, format: string): string {
  const id = typeof document.id === "string" ? document.id : "pack";
  const version = typeof document.version === "string" ? document.version : "0.0.0";
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "copy";
  return `${slug(id.split(".").pop() ?? "pack")}-${version}-${slug(to)}.${format}`;
}

/**
 * Say what a pack's signature amounts to, as part of validating it.
 *
 * Careful about what is claimed. A valid signature proves the contents are
 * unchanged since *someone* signed them; it says nothing about who that
 * someone is unless the reader already knows the fingerprint.
 */
export async function reportSignature(document: unknown): Promise<void> {
  const result = await verifyPack(document);
  if (result.status === "unsigned") return;

  if (result.status === "unverifiable") {
    console.log(paint(YELLOW, "signature: present, but not checked"));
    console.log(paint(DIM, `  ${result.reason}`));
    return;
  }

  if (result.status === "invalid") {
    console.log(paint(RED, "signature: does not match"));
    console.log(paint(DIM, `  ${result.reason}`));
    return;
  }

  const issue = (document as { issue?: { to?: string; reference?: string } } | null)?.issue;
  if (issue?.to) {
    console.log(
      `${paint(GREEN, "issued to")} ${issue.to}${issue.reference ? paint(DIM, ` · ref ${issue.reference}`) : ""}`,
    );
  }

  const who = result.signedBy ? ` by ${result.signedBy}` : "";
  console.log(`${paint(GREEN, "signature: valid")}${who}`);
  console.log(paint(DIM, `  fingerprint ${result.fingerprint} · signed ${result.signedAt}`));
  console.log(
    paint(DIM, "  unchanged since it was signed. Check that fingerprint against the author's."),
  );
}
