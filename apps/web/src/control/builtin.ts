import { parse, type ControlProfile } from "./profile.ts";

/**
 * The profiles that ship with the app.
 *
 * A profile is a file, and handing somebody a file to find and import
 * before anything works is a poor way to start. The ones written here,
 * for the packs written here, are bundled and offered by name: pick the
 * pack's own and play.
 *
 * They are still only a starting point. What is picked is copied into
 * the run and edited from there, so changing one is changing your copy,
 * and exporting it gives you the file back.
 */
const files = import.meta.glob("../../../../packs/profiles/*.json", { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

export interface Builtin {
  /** The file's own name, which is what makes it unique in a list. */
  id: string;
  title: string;
  /** The pack it was written for, where it says. */
  pack?: string;
  profile: ControlProfile;
}

let loaded: Builtin[] | null = null;

/** Every shipped profile, read once. */
export async function builtins(): Promise<Builtin[]> {
  if (loaded) return loaded;
  const out: Builtin[] = [];
  for (const [path, read] of Object.entries(files)) {
    const id =
      path
        .split("/")
        .pop()
        ?.replace(/\.json$/, "") ?? path;
    try {
      const profile = parse(await read());
      // A shipped profile that does not parse is a bug in this
      // repository rather than something to show anybody.
      if (profile) out.push({ id, title: profile.title ?? id, ...(profile.pack ? { pack: profile.pack } : {}), profile });
    } catch {
      // Unreadable: leave it out rather than break the list.
    }
  }

  loaded = out.sort((a, b) => a.title.localeCompare(b.title));
  return loaded;
}

/** The shipped profiles written for this pack, best first. */
export function forPack(all: Builtin[], packId: string): Builtin[] {
  return [...all].sort((a, b) => Number(b.pack === packId) - Number(a.pack === packId));
}
