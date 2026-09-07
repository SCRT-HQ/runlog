import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

/**
 * The app, served from this machine.
 *
 * The published package carries the built app beside the command, so
 * `npx @scrthq/runlog serve` puts Runlog on a local port with nothing
 * else installed: a designer's own copy, a table with no internet, a
 * machine where the hosted address is not wanted. What is served is the
 * same build the hosted address serves, less the hosted layer: no sign-in
 * and no sync, since those need an address to sign into; everything else,
 * the packs and runs on this browser included, works as it does anywhere.
 *
 * A plain static server: files by path, the app's page for any path that
 * is not a file, so a link into the app opens. Nothing is cached hard,
 * so a newer package is a newer app on the next reload.
 */

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".pdf": "application/pdf",
  ".map": "application/json",
};

export function contentType(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** The file a request path names inside the app directory, or null when it would step outside. */
export function fileFor(dir: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]!.split("#")[0]!);
  } catch {
    return null;
  }
  const root = resolve(dir);
  const target = normalize(join(root, decoded));
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

/**
 * Where the app is: `--dir`, `RUNLOG_APP_DIR`, the `app` folder beside the
 * published command, or the workspace's own build when run from source.
 */
export function appDir(explicit?: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    explicit,
    env["RUNLOG_APP_DIR"],
    join(here, "..", "app"), // dist/runlog.js -> app/
    join(here, "..", "..", "..", "apps", "web", "dist"), // packages/cli/src -> apps/web/dist
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) if (existsSync(join(c, "index.html"))) return resolve(c);
  return null;
}

export interface ServeOptions {
  dir: string;
  port: number;
  host: string;
}

export function startServer({ dir, port, host }: ServeOptions): Promise<{ url: string; close: () => void; port: number }> {
  const index = join(dir, "index.html");
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    const target = fileFor(dir, req.url ?? "/");
    if (!target) {
      res.writeHead(400).end("no");
      return;
    }
    let file = target;
    try {
      if (statSync(file).isDirectory()) file = join(file, "index.html");
    } catch {
      // Not a file: the app's page, which reads the address itself.
      file = index;
    }
    if (!existsSync(file)) file = index;
    const body = readFileSync(file);
    const type = contentType(file);
    // The page and the worker are always fresh; the hashed assets can be kept a while.
    const cache = file === index || file.endsWith("sw.js") ? "no-cache" : "public, max-age=3600";
    res.writeHead(200, { "content-type": type, "content-length": body.length, "cache-control": cache });
    res.end(req.method === "HEAD" ? undefined : body);
  };
  return new Promise((done, fail) => {
    const server = createServer(handler);
    server.on("error", fail);
    server.listen(port, host, () => {
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : port;
      const shownHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
      done({ url: `http://${shownHost}:${bound}/`, port: bound, close: () => server.close() });
    });
  });
}

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

/** Open the address in the machine's browser; quietly, since a failure here is a URL to paste. */
function openInBrowser(url: string): void {
  const [cmd, argv] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, argv, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* the URL is printed either way */
  }
}

export async function cmdServe(args: string[]): Promise<number> {
  const port = Number(flag(args, "--port") ?? flag(args, "-p") ?? process.env["PORT"] ?? 3535);
  const host = flag(args, "--host") ?? "127.0.0.1";
  const dir = appDir(flag(args, "--dir"));
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("usage: runlog serve [--port 3535] [--host 127.0.0.1] [--open] [--dir path/to/app]");
    return 2;
  }
  if (!dir) {
    console.error("the app is not here: this copy of the command was built without it, or --dir / RUNLOG_APP_DIR points somewhere else");
    return 1;
  }
  try {
    const { url } = await startServer({ dir, port, host });
    console.log(`Runlog is at ${url}`);
    console.log(`  serving ${dir}`);
    console.log("  local only: packs and runs stay in this browser; sign in and sync need the hosted address");
    console.log("  Ctrl+C to stop");
    if (args.includes("--open")) openInBrowser(url);
    await new Promise<void>((done) => {
      process.on("SIGINT", () => done());
      process.on("SIGTERM", () => done());
    });
    return 0;
  } catch (error) {
    const code = (error as { code?: string }).code;
    console.error(code === "EADDRINUSE" ? `port ${port} is taken; pass --port with another` : error instanceof Error ? error.message : String(error));
    return 1;
  }
}
