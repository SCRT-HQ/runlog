import { copyFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Plugin } from "vite";

/**
 * Serving the published JSON Schemas.
 *
 * `pack-1.schema.json` says its own `$id` is
 * `https://runlog.dev/schema/pack-1.schema.json`, the authoring guide tells
 * every author to put that address at the top of their file, and nothing
 * had ever put the file at that address. What came back was the app's own
 * index page with a 200 on it, which an editor reads as a schema that is
 * not one and then says nothing at all about the file being edited. The
 * advice was good and the address was furniture.
 *
 * So the schemas are copied out of the package that emits them, at build
 * time, and served in the dev server from the same place. Copied rather
 * than kept in `public/`: a generated file with a second committed copy
 * beside it drifts, and the drift is invisible until somebody's editor
 * disagrees with the validator.
 *
 * Deliberately not part of the bundle. The offline worker precaches what
 * the bundle holds, and these are for other people's editors rather than
 * for this app, which never reads them.
 */
const from = fileURLToPath(new URL("../../packages/rules-schema/schema", import.meta.url));

/** The schema files there are, by the name each is served under. */
function published(): string[] {
  return readdirSync(from).filter((name) => name.endsWith(".schema.json"));
}

export function schemas(): Plugin {
  return {
    name: "runlog-schemas",
    // Served from disk in dev so the address works the same locally: an
    // author pointing an editor at a local copy is a supported way to work
    // on a pack, and it is how this would have been caught.
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "").split("?")[0] ?? "";
        const name = path.startsWith("/schema/") ? path.slice("/schema/".length) : null;
        if (!name || !published().includes(name)) return next();
        response.setHeader("content-type", "application/schema+json");
        response.setHeader("access-control-allow-origin", "*");
        response.end(readFileSync(join(from, name)));
      });
    },
    writeBundle(options) {
      const outDir = options.dir ?? fileURLToPath(new URL("./dist", import.meta.url));
      const into = join(outDir, "schema");
      mkdirSync(into, { recursive: true });
      for (const name of published()) copyFileSync(join(from, name), join(into, name));
    },
  };
}
