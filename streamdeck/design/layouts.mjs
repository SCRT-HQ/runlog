/**
 * Where the packs a profile is laid out for live, and what each ships as.
 *
 * The decks, the keys and the arranging are `@runlog/deck-profiles`, which
 * a browser runs as well as this script does. What is left here is the part
 * that is only true of this repository: which files are read, and the name
 * each pack's profile has shipped under.
 */

/**
 * The packs a profile is laid out for: the demo pack, and every sketch.
 *
 * Paths rather than a list of packs, because the list is whatever is on
 * disk. `profiles.mjs` reads the sketches folder, so a pack added to the
 * repository has a profile on the next run of the generator without anybody
 * editing a list here.
 */
export const DEMO = { slug: "demo", file: "packs/demo/pack.yaml" };
export const SKETCHES = "packs/sketches";

/**
 * A pack's slug is its file's stem, and these are the exceptions.
 *
 * The slug is what names the `.streamDeckProfile` file, the manifest entry
 * and the profile the plugin switches to, so changing one renames a profile
 * on every deck that already has it. Elden Ring's was laid out before the
 * rule existed and keeps the name it shipped under.
 */
export const SLUGS = { "elden-ring-tarnishedtool": "elden-ring" };
