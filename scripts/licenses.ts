import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The third-party notice: what a built app carries, and under which
 * licenses. Read from the lockfile where the app is built, and shipped
 * with the published package as `licenses.json` so that a copy laid over
 * the package, which has no lockfile, can still say what it is made of.
 */
export interface Dependency {
  name: string;
  version: string;
  license: string;
  /** The package's own LICENSE file, where it ships one. */
  text?: string;
}

/**
 * What the built app carries, from the lockfile: every package that is not
 * development-only, with the license its own package.json declares. The
 * app's bundler tree-shakes most of these to nothing, but a notice that
 * names more than was shipped is honest; one that names less is not.
 */
export function dependenciesOf(appRoot: string): Dependency[] {
  const lock = JSON.parse(readFileSync(join(appRoot, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string; dev?: boolean; license?: string; link?: boolean; dependencies?: Record<string, string> }>;
  };
  // The workspace holds the hosting's own packages too, which never reach
  // a browser. What the app ships is what its packages depend on, walked
  // from the app and the libraries beneath it through the lockfile.
  const roots = ["apps/web", "packages/rules-schema", "packages/engine", "packages/container"].filter((r) => lock.packages[r]);
  const wanted = new Set<string>();
  const queue: Array<[string, string]> = [];
  for (const r of roots) {
    const deps = lock.packages[r]?.dependencies ?? {};
    for (const name of Object.keys(deps)) queue.push([r, name]);
  }
  // A lockfile with no workspace roots (a plain app, or a test's) lists what
  // it ships at the top; one with no top either is taken whole.
  if (roots.length === 0) {
    const top = lock.packages[""]?.dependencies;
    if (top) for (const name of Object.keys(top)) queue.push(["", name]);
    else for (const path of Object.keys(lock.packages)) if (path.startsWith("node_modules/")) wanted.add(path);
  }
  const resolve = (from: string, name: string): string | undefined => {
    // npm's resolution: the nearest node_modules up from the dependent.
    let dir = from;
    for (;;) {
      const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
      if (lock.packages[candidate]) return candidate;
      if (!dir) return undefined;
      const i = dir.lastIndexOf("/node_modules/");
      dir = i >= 0 ? dir.slice(0, i) : "";
    }
  };
  while (queue.length > 0) {
    const [from, name] = queue.shift()!;
    if (name.startsWith("@runlog/") || name.startsWith("@scrthq/")) continue;
    const path = resolve(from, name);
    if (!path || wanted.has(path)) continue;
    wanted.add(path);
    for (const dep of Object.keys(lock.packages[path]?.dependencies ?? {})) queue.push([path, dep]);
  }
  const out: Dependency[] = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!wanted.has(path) || entry.dev || entry.link) continue;
    // Nested copies of a package appear as node_modules/a/node_modules/b;
    // the name is the last node_modules segment.
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const dir = join(appRoot, path);
    let license = entry.license ?? "";
    let text: string | undefined;
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { license?: string | { type?: string } };
      license ||= typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "");
      const file = readdirSync(dir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
      if (file) text = readFileSync(join(dir, file), "utf8");
    } catch {
      // Not installed here; the lockfile's word will do.
    }
    out.push({ name, version: entry.version ?? "", license: license || "see package", ...(text ? { text } : {}) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
