import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Session } from "./flow.ts";

/**
 * Where a program keeps its session: the platform's config directory,
 * one folder per program, readable by its owner and nobody else. The
 * CLI's rule, with the folder name handed in, so the deck and the CLI
 * keep separate sessions in the same place.
 */
export function configDir(app: string): string {
  const base =
    process.platform === "win32"
      ? (process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"))
      : (process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"));
  return join(base, app);
}

const FILE = "session.json";

export function readSession(dir: string): Session | null {
  try {
    const s = JSON.parse(readFileSync(join(dir, FILE), "utf8")) as Partial<Session>;
    if (typeof s.accessToken === "string" && typeof s.refreshToken === "string" && typeof s.clientId === "string")
      return {
        clientId: s.clientId,
        issuer: s.issuer ?? "https://api.workos.com",
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        expiresAt: s.expiresAt ?? new Date(0).toISOString(),
      };
  } catch {
    /* none yet */
  }
  return null;
}

export function writeSession(dir: string, session: Session): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, FILE);
  writeFileSync(path, JSON.stringify(session), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows: ACLs, not modes; the profile directory is already the user's own */
  }
}

export function forgetSession(dir: string): void {
  const path = join(dir, FILE);
  if (existsSync(path)) rmSync(path);
}
