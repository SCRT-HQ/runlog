import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { dependenciesOf } from "./licenses.ts";

/**
 * Stage the packages this repository publishes to npm.
 *
 * The workspace runs on TypeScript source: every package's `main` points at
 * `src/index.ts`, and nothing here is built to be imported. Publishing needs
 * the opposite — JavaScript, declarations, and a package.json that points at
 * them — so each published package is assembled in a `stage/` directory
 * from a build, with a package.json written here rather than copied. What
 * the workspace uses and what npm receives never have to agree.
 *
 * One package leaves, `@scrthq/runlog`, with two entry points:
 *
 *  - the `runlog` command, bundled into one file with esbuild: its
 *    dependencies on the schema and engine packages are workspace-only, and
 *    a bundle is how a package that is not published gets to ship;
 *  - a library entry point that is the container package, bundled the same
 *    way (it has nothing underneath it), with declarations from tsc so the
 *    types are real. A seller's backend imports `seal` from here;
 *  - the built app, in `app/`, so `runlog serve` puts Runlog on a local
 *    port with nothing else installed. The app is built before staging;
 *    a stage without it still publishes, and `serve` says the app is not
 *    there.
 *
 * The version is the release tag's, passed in, so the package carries the
 * app's version and a release is one number everywhere.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2]?.replace(/^v/, "") ?? undefined;

const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, unknown>;

function stageDir(pkg: string): string {
  const dir = join(root, "packages", pkg, "stage");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "dist"), { recursive: true });
  return dir;
}

const common = {
  type: "module",
  license: "MIT",
  repository: { type: "git", url: "git+https://github.com/SCRT-HQ/runlog.git" },
  homepage: "https://github.com/SCRT-HQ/runlog#readme",
  bugs: "https://github.com/SCRT-HQ/runlog/issues",
  engines: { node: ">=20" },
  publishConfig: { access: "public" },
};

/**
 * The third-party packages the command needs, collected from every
 * workspace package that goes into its bundle. These stay outside the
 * bundle and are declared as the published package's dependencies, so
 * npm shows what is really there and installs it; only the unpublished
 * workspace packages are bundled in.
 */
function thirdParty(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pkg of ["cli", "rules-schema", "engine", "container"]) {
    const deps = (read(`packages/${pkg}/package.json`)["dependencies"] ?? {}) as Record<string, string>;
    for (const [name, range] of Object.entries(deps)) if (!name.startsWith("@runlog/")) out[name] = range;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

async function cli(): Promise<void> {
  const src = read("packages/cli/package.json");
  const dir = stageDir("cli");
  const dependencies = thirdParty();
  await build({
    entryPoints: [join(root, "packages", "cli", "src", "bin.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: join(dir, "dist", "runlog.js"),
    // The workspace's own packages go in, since they are not published;
    // the third-party ones stay out and are declared, so the package on
    // npm says what it depends on. A CommonJS dependency inside an ES
    // module bundle needs `require` to exist, and esbuild does not create
    // it on its own.
    external: Object.keys(dependencies),
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    legalComments: "none",
    logLevel: "warning",
  });
  // The source's hashbang asks for --experimental-strip-types, which the
  // bundle no longer needs and `env` on Linux cannot pass anyway; esbuild
  // keeps it, so it is replaced with the plain one here.
  const out = join(dir, "dist", "runlog.js");
  writeFileSync(out, readFileSync(out, "utf8").replace(/^#!.*\n/, "#!/usr/bin/env node\n"));

  // The library: the container package, as a module with declarations.
  await build({
    entryPoints: [join(root, "packages", "container", "src", "index.ts")],
    bundle: true,
    platform: "neutral",
    format: "esm",
    target: "es2022",
    outfile: join(dir, "dist", "index.js"),
    legalComments: "none",
    logLevel: "warning",
  });
  execFileSync("npx", ["tsc", "-p", "tsconfig.build.json", "--declaration", "--emitDeclarationOnly", "--outDir", join(dir, "dist", "types")], {
    cwd: join(root, "packages", "container"),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  cpSync(join(root, "packages", "cli", "README.md"), join(dir, "README.md"));
  // The third-party notice, so a copy laid over this package at someone's
  // own address can say what the app is made of (hosted/scripts/overlay.ts).
  writeFileSync(join(dir, "licenses.json"), JSON.stringify(dependenciesOf(root)));
  const app = join(root, "apps", "web", "dist");
  if (existsSync(join(app, "index.html"))) {
    cpSync(app, join(dir, "app"), { recursive: true });
    console.log("  with the app");
  } else {
    console.log("  without the app (apps/web/dist is not built)");
  }
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: src["name"],
        version: version ?? src["version"],
        description: src["description"],
        ...common,
        // No "./": npm 11 and later drop a bin whose path starts with one.
        bin: { runlog: "dist/runlog.js" },
        exports: { ".": { types: "./dist/types/index.d.ts", default: "./dist/index.js" } },
        main: "./dist/index.js",
        types: "./dist/types/index.d.ts",
        files: ["dist", "app", "README.md", "licenses.json"],
        dependencies,
        keywords: ["runlog", "tabletop", "rule-pack", "cli", "rlpack", "seal", "license"],
      },
      null,
      2,
    )}\n`,
  );
  console.log(`staged ${String(src["name"])}@${String(version ?? src["version"])} -> ${dir}`);
}

await cli();
