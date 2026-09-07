import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DOC_KINDS, generateDoc, loadPackText, detectFormat, toHtml, toMarkdown, type DocKind } from "@runlog/rules-schema";
import { readFileSync } from "node:fs";

/**
 * `runlog docs <pack> [-o dir] [--only kinds] [--md | --html]`
 *
 * The paper that goes with a pack, written from the pack: a rulebook, a
 * quick start, a reference card, a run log sheet, and the summary a catalog
 * shows. HTML by default because a browser prints it to a PDF with the page
 * breaks and columns already right; Markdown for anyone who wants to edit
 * or paste it. Both, unless told one.
 */
export function cmdDocs(args: string[]): number {
  const files = args.filter((a) => !a.startsWith("-"));
  const input = files[0];
  if (!input) {
    console.error("usage: runlog docs <pack.yaml> [-o dir] [--only summary,rulebook,quickstart,reference,runlog] [--md | --html]");
    return 2;
  }
  const outIndex = args.findIndex((a) => a === "-o" || a === "--out");
  const onlyIndex = args.findIndex((a) => a === "--only");
  const wanted = new Set<DocKind>(
    onlyIndex >= 0 && args[onlyIndex + 1] ? (args[onlyIndex + 1]!.split(",").map((k) => k.trim()) as DocKind[]) : DOC_KINDS.map((k) => k.kind),
  );
  for (const k of wanted) {
    if (!DOC_KINDS.some((d) => d.kind === k)) {
      console.error(`no such document: ${k}. Choose from ${DOC_KINDS.map((d) => d.kind).join(", ")}.`);
      return 2;
    }
  }
  const formats = args.includes("--md") && !args.includes("--html") ? ["md"] : args.includes("--html") && !args.includes("--md") ? ["html"] : ["html", "md"];

  const path = resolve(input);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    console.error(`cannot read ${input}`);
    return 1;
  }
  const loaded = loadPackText(text, detectFormat(path));
  if (!loaded.ok) {
    console.error(`${basename(input)} does not load; run \`runlog validate\` to see why`);
    return 1;
  }
  const { pack } = loaded;
  const dir = outIndex >= 0 && args[outIndex + 1] ? resolve(args[outIndex + 1]!) : resolve(`${pack.id}-docs`);
  mkdirSync(dir, { recursive: true });

  for (const kind of DOC_KINDS) {
    if (!wanted.has(kind.kind)) continue;
    const doc = generateDoc(pack, kind.kind);
    for (const format of formats) {
      const file = join(dir, `${kind.kind}.${format}`);
      writeFileSync(file, format === "md" ? toMarkdown(doc) : toHtml(doc), "utf8");
      console.log(`${kind.label.padEnd(14)} ${file}`);
    }
  }
  if (!pack.license.redistributable) {
    console.log("note: this pack is marked non-redistributable. The summary is safe to show anyone; keep the rest as private as the pack.");
  } else {
    console.log("open an .html in a browser and print it for a PDF; the reference card lays out in columns and the run log as a sheet.");
  }
  return 0;
}
