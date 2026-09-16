import { readdirSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

import { PACK_PROFILES } from "./profiles.ts";

/**
 * Which profiles the Stream Deck app already has, read off its own folder.
 *
 * A profile handed over is the app's to keep: it asks the streamer, it names
 * the file, and it tells the plugin nothing about what came of it. Importing
 * the same one twice leaves two, the second called "<title> copy", so a
 * plugin that offers again on every launch fills somebody's list with copies
 * of one profile. The app's folder is the only record of what is already
 * there, so that is what is read.
 *
 * The SDK has no path for this. What it does have is a plugin folder inside
 * the app's own tree, but a plugin is installed somewhere else again, so the
 * two documented locations are named here instead.
 */

/** The plugin that installs the profiles this ships, as a profile records it. */
const PLUGIN_UUID = "com.scrthq.runlog";

/** One profile in the app's list, as much of its manifest as this reads. */
export interface InstalledProfile {
  name: string;
  /** The plugin that put it there, for one the plugin declared rather than one somebody imported. */
  installedBy?: string;
  /** The manifest name the plugin asked for, which is `profiles/<slug>-<deck>`. */
  preconfigured?: string;
}

/** Where the Stream Deck app keeps profiles, or nothing on a platform it does not run on. */
export function profilesDir(): string | null {
  if (platform() === "win32") {
    const appData = process.env.APPDATA;
    return appData ? join(appData, "Elgato", "StreamDeck", "ProfilesV3") : null;
  }
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "com.elgato.StreamDeck", "ProfilesV3");
  return null;
}

/**
 * Every profile in the folder, by name.
 *
 * Nothing here throws: the app may not be installed, the folder may not
 * exist yet on a fresh machine, and a manifest may be half written while
 * the app saves one. A folder that cannot be read is no profiles, which
 * offers a build rather than refusing one.
 */
export function installedProfiles(dir: string | null = profilesDir()): InstalledProfile[] {
  if (!dir) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".sdProfile"));
  } catch {
    return [];
  }
  const out: InstalledProfile[] = [];
  for (const entry of entries) {
    try {
      const raw: unknown = JSON.parse(readFileSync(join(dir, entry, "manifest.json"), "utf8"));
      if (typeof raw !== "object" || raw === null) continue;
      const m = raw as { Name?: unknown; InstalledByPluginUUID?: unknown; PreconfiguredName?: unknown };
      if (typeof m.Name !== "string") continue;
      out.push({
        name: m.Name,
        ...(typeof m.InstalledByPluginUUID === "string" ? { installedBy: m.InstalledByPluginUUID } : {}),
        ...(typeof m.PreconfiguredName === "string" ? { preconfigured: m.PreconfiguredName } : {}),
      });
    } catch {
      /* a profile whose manifest will not read is one this cannot claim */
    }
  }
  return out;
}

/**
 * A profile name with the app's own copy suffixes taken off.
 *
 * Importing a profile the app already has does not replace it: it keeps
 * both and calls the new one "<title> copy", and importing again on top of
 * that gives "<title> copy copy". So the suffix comes off before the name
 * is compared, however many of them there are.
 */
export function withoutCopies(name: string): string {
  return name.replace(/(?:\s+copy)+$/i, "").trim();
}

/**
 * Whether the app already holds a profile for this pack.
 *
 * Two rules, and the name is the first of them: every profile this builds
 * is named for the pack, and a pack's title is what a streamer would see in
 * the app's list. Second, for a pack the plugin ships a layout for, the
 * manifest name the plugin asked the app to install under. Nothing reads
 * the keys inside: a Press key names a move and not the pack it came from,
 * and the one key that does name a pack, Open set to the rules, is on the
 * generic profile too.
 */
export function hasProfileFor(pack: { id: string; title?: string }, profiles: InstalledProfile[]): boolean {
  const title = pack.title?.trim();
  const shipped = PACK_PROFILES[pack.id];
  return profiles.some((p) => {
    if (title && withoutCopies(p.name) === title) return true;
    return p.installedBy === PLUGIN_UUID && shipped !== undefined && (p.preconfigured ?? "").startsWith(`profiles/${shipped}-`);
  });
}
