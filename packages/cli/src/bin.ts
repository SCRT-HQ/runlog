#!/usr/bin/env node
/**
 * `runlog`: the pack author's tool.
 *
 * This is the designer-facing half of the project. Someone writing a game
 * should be able to run one command in CI and know their pack is coherent
 * before it reaches a player, without installing an editor plugin or reading
 * the engine's source. Everything here is in service of that.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import YAML from "yaml";
import { createHash } from "node:crypto";
import {
  detectFormat,
  hasErrors,
  loadPackText,
  type Diagnostic,
  type Pack,
} from "@runlog/rules-schema";
import { runFixtures } from "./fixtures.ts";
import { cmdIssue, cmdKeygen, cmdSign, reportSignature } from "./sign.ts";
import { cmdClaim, cmdLogin, cmdLogout, cmdPublish, cmdRelease, cmdWhoami } from "./account.ts";
import { cmdDocs } from "./docs.ts";
import { cmdServe } from "./serve.ts";

const RESET = "[0m";
const RED = "[31m";
const YELLOW = "[33m";
const GREEN = "[32m";
const DIM = "[2m";
const BOLD = "[1m";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string, text: string) => (useColor ? `${code}${text}${RESET}` : text);

function printDiagnostics(diagnostics: Diagnostic[], file: string): void {
  if (diagnostics.length === 0) return;
  console.error("");
  for (const d of diagnostics) {
    const tag =
      d.level === "error" ? paint(RED, "error") : paint(YELLOW, "warning");
    const where = d.path ? paint(DIM, ` at ${d.path}`) : "";
    console.error(`  ${tag} ${paint(DIM, d.code)}${where}`);
    console.error(`    ${d.message}`);
  }
  console.error("");
  const errors = diagnostics.filter((d) => d.level === "error").length;
  const warnings = diagnostics.length - errors;
  const parts: string[] = [];
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  console.error(`  ${parts.join(", ")} in ${file}`);
}

function read(path: string): { text: string; pack: Pack | null; diagnostics: Diagnostic[] } {
  const abs = resolve(path);
  if (!existsSync(abs)) {
    console.error(paint(RED, `no such file: ${path}`));
    process.exit(2);
  }
  const text = readFileSync(abs, "utf8");
  const result = loadPackText(text, detectFormat(abs));
  return { text, pack: result.pack, diagnostics: result.diagnostics };
}

/** Exit non-zero on errors, and on warnings too when --strict is passed. */
function report(path: string, diagnostics: Diagnostic[], strict: boolean): number {
  printDiagnostics(diagnostics, basename(path));
  if (hasErrors(diagnostics)) return 1;
  if (strict && diagnostics.length > 0) {
    console.error(paint(YELLOW, "  --strict: treating warnings as failures"));
    return 1;
  }
  return 0;
}

async function cmdValidate(args: string[]): Promise<number> {
  const strict = args.includes("--strict");
  const files = args.filter((a) => !a.startsWith("-"));
  if (files.length === 0) {
    console.error("usage: runlog validate <pack.yaml|pack.json> [--strict]");
    return 2;
  }
  let worst = 0;
  for (const file of files) {
    const { pack, diagnostics } = read(file);
    const code = report(file, diagnostics, strict);
    worst = Math.max(worst, code);
    if (pack && code === 0) {
      const tables = Object.keys(pack.tables).length;
      const entries = Object.values(pack.tables).reduce((n, t) => n + t.entries.length, 0);
      console.log(
        `${paint(GREEN, "ok")} ${paint(BOLD, pack.title)} ${paint(DIM, `v${pack.version}`)} - ` +
          `${tables} table${tables === 1 ? "" : "s"}, ${entries} entries, ` +
          `${Object.keys(pack.modes).length} mode(s)` +
          (diagnostics.length ? paint(YELLOW, `, ${diagnostics.length} warning(s)`) : ""),
      );
      // Reported after the pack itself, and only when it loads: a signature on
      // something that does not parse is not the reader's first problem.
      await reportSignature(YAML.parse(readFileSync(resolve(file), "utf8")));
    }
  }
  return worst;
}

/**
 * Normalize a validated pack into the single JSON artifact a release ships.
 *
 * The hash exists so a player can tell two packs claiming the same version
 * apart, which matters once packs are passed around outside a release process.
 */
function cmdBundle(args: string[]): number {
  const files = args.filter((a) => !a.startsWith("-"));
  const outIndex = args.findIndex((a) => a === "-o" || a === "--out");
  const input = files[0];
  if (!input) {
    console.error("usage: runlog bundle <pack.yaml> [-o dist/pack.json]");
    return 2;
  }
  const { pack, diagnostics } = read(input);
  if (!pack) {
    report(input, diagnostics, false);
    return 1;
  }
  printDiagnostics(
    diagnostics.filter((d) => d.level === "warning"),
    basename(input),
  );

  const body = JSON.stringify(pack, null, 2);
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
  const bundled = { ...pack, bundledAt: new Date().toISOString(), contentHash: hash };
  const out =
    outIndex >= 0 && args[outIndex + 1]
      ? resolve(args[outIndex + 1]!)
      : resolve(`${pack.id}-${pack.version}.pack.json`);

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(bundled, null, 2)}\n`, "utf8");
  console.log(`${paint(GREEN, "bundled")} ${out} ${paint(DIM, `sha256:${hash}`)}`);
  if (!pack.license.redistributable) {
    console.log(
      paint(
        YELLOW,
        "  note: this pack is marked non-redistributable. Keep the bundle private.",
      ),
    );
  }
  return 0;
}

/**
 * Replay the pack's own fixtures.
 *
 * The author's own worked examples, checked against the engine that will
 * actually play their game. This is what makes a pack safe to edit: change a
 * table, run this, and find out whether you changed what you meant to.
 */
function cmdTest(args: string[]): number {
  const input = args.filter((a) => !a.startsWith("-"))[0];
  if (!input) {
    console.error("usage: runlog test <pack.yaml>");
    return 2;
  }
  const { pack, diagnostics } = read(input);
  if (!pack) {
    report(input, diagnostics, false);
    return 1;
  }
  const fixtures = pack.fixtures ?? [];
  if (fixtures.length === 0) {
    console.log(paint(DIM, "no fixtures in this pack"));
    return 0;
  }
  console.log(`${fixtures.length} fixture(s):`);
  const results = runFixtures(pack);

  for (const result of results) {
    if (result.ok) {
      console.log(`  ${paint(GREEN, "pass")} ${result.name}`);
      continue;
    }
    console.log(`  ${paint(RED, "fail")} ${result.name}`);
    if (result.error) console.log(`    ${paint(DIM, result.error)}`);
    for (const a of result.assertions) {
      if (a.ok) continue;
      // Both values, always: "expected 1" without "got 0" sends the author
      // back to the app to find out what actually happened.
      console.log(
        `    ${a.path}: expected ${JSON.stringify(a.expected)}, got ${JSON.stringify(a.actual)}`,
      );
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(
    failed === 0
      ? paint(GREEN, `all ${results.length} passed`)
      : paint(RED, `${failed} of ${results.length} failed`),
  );
  return failed === 0 ? 0 : 1;
}

function cmdInit(args: string[]): number {
  const name = args.filter((a) => !a.startsWith("-"))[0] ?? "my-pack";
  const out = resolve(`${name}.yaml`);
  if (existsSync(out)) {
    console.error(paint(RED, `refusing to overwrite ${out}`));
    return 1;
  }
  writeFileSync(out, SKELETON.replaceAll("__NAME__", name), "utf8");
  console.log(`${paint(GREEN, "created")} ${out}`);
  console.log(paint(DIM, `  next: runlog validate ${name}.yaml`));
  return 0;
}

const SKELETON = `# A Runlog rule pack. Point your editor at the schema below for completions.
$schema: https://runlog.dev/schema/pack-1.schema.json
schemaVersion: 1
id: com.example.__NAME__
version: "0.1.0"
title: __NAME__
license:
  id: MIT
  redistributable: true
capabilities: []

# The words your game uses. The interface speaks these.
vocabulary:
  run: { one: Run, many: Runs }
  unit: { one: Round, many: Rounds }
  subject: { one: Piece, many: Pieces }
  finalize: Finish

tables:
  constraint:
    resolution: lookup
    title: Constraint
    roll: d6
    entries:
      # Entries must tile the whole dice range: no gaps, no overlaps.
      - { id: c1, range: [1, 2], text: Work with one color only. }
      - { id: c2, range: [3, 4], text: Finish in under ten minutes. }
      - { id: c3, range: [5, 6], text: Use your non-dominant hand. }

phases:
  - id: constrain
    label: Constraint
    steps:
      - { kind: rollTable, table: constraint, label: Roll the Constraint }
  - id: work
    label: Work
    steps:
      - { kind: manual, label: Make the thing. }
  - id: close
    label: Finish
    steps:
      - kind: finalizeUnit
        confirm:
          - The Constraint was honored.

modes:
  standard:
    label: Standard
defaultMode: standard
`;

const HELP = `runlog: author and check rule packs

usage:
  runlog validate <pack...> [--strict]   check a pack's shape and coherence
  runlog bundle   <pack> [-o out.json]   normalize to a distributable JSON
  runlog test     <pack>                 replay the pack's own fixtures
  runlog init     [name]                 scaffold a new pack
  runlog serve    [--port 3535] [--open] run the app from this machine, offline, nothing else installed
  runlog docs     <pack> [-o dir]        write its rulebook, quick start, reference card,
                    [--only kinds]         run log sheet and catalog summary (HTML and Markdown)
  runlog keygen   [-o key.json]          make a signing key for your packs
  runlog sign     <pack> --key key.json  sign a pack, proving you wrote it
  runlog issue    <pack> --to "Name"     stamp a copy with a buyer's name and sign it
                    [--seal]             …and seal it, so it needs a license key to open
                                         (both take the key from RUNLOG_SIGNING_KEY instead)

  runlog login    [--api URL]            sign in: a code to confirm in your browser
                    [--key]              …or paste a key from your profile page, for a machine with no browser
  runlog whoami                          who the command line is acting as
  runlog claim    key.json               prove a signing key is yours; the app then names you
  runlog publish  <pack>                 put a pack in your library, on every device
  runlog release  <pack> [--price 3.00]  upload a signed pack to the catalog as its publisher
                    [--free] [--draft]     and list it; no flag keeps the listing as it is
  runlog logout                          forget the sign-in

--strict makes warnings fail, which is what you want in CI. In CI, set
RUNLOG_API_KEY to a key from your profile page instead of running login,
and RUNLOG_SIGNING_KEY to your key file's contents instead of --key; nobody
is there to confirm a code. examples/github-actions in the repository has
workflows to copy.

Signing proves authorship. It does not restrict copying and cannot: the app
has to read every word of a pack to play it. What it gives you is that an
altered copy can no longer claim to be yours, and, once the key is claimed
by your account, that the app names you beside it. sign and issue refuse a
key that is not claimed.
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case "validate":
      return cmdValidate(args);
    case "bundle":
      return cmdBundle(args);
    case "docs":
      return cmdDocs(args);
    case "test":
      return cmdTest(args);
    case "keygen":
      return cmdKeygen(args);
    case "sign":
      return cmdSign(args);
    case "issue":
      return cmdIssue(args);
    case "login":
      return cmdLogin(args);
    case "logout":
      return cmdLogout();
    case "whoami":
      return cmdWhoami();
    case "claim":
      return cmdClaim(args);
    case "publish":
      return cmdPublish(args);
    case "release":
      return cmdRelease(args);
    case "init":
      return cmdInit(args);
    case "serve":
      return cmdServe(args);
    case "-h":
    case "--help":
    case "help":
    case undefined:
      console.log(HELP);
      return command === undefined ? 2 : 0;
    default:
      console.error(`unknown command: ${command}\n`);
      console.error(HELP);
      return 2;
  }
}

process.exit(await main(process.argv.slice(2)));
