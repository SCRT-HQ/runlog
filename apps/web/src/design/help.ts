/**
 * Task-focused help, keyed by the same schema paths as describe(). Review this
 * copy alongside schema changes: help.test.ts catches keys that the schema no
 * longer describes. These sentences explain editing choices, not validation
 * rules; the schema and linter remain the authority on whether a pack loads.
 */
export const HELP: Record<string, string> = {
  id: "Use a domain you control, written backward, followed by your pack's name. Packs with the same id share one place in a player's library.",
  version: "Change this when you release an updated pack so players can tell their copies apart.",
  tags: "Add words players might use to find this pack. Separate them with commas.",
  "requires[].kind": "Choose the kind of thing this requirement is so the Marketplace can summarize what players need.",
  "requires[].optional": "Players can play without this. Results that name it in Needs are drawn again when a player does not have it.",
  "vocabulary.run": "Your name for a whole session, such as a firing. Give the app a word for one and a word for many.",
  "vocabulary.unit": "Your name for one turn within a session, such as a stage. Give the app a word for one and a word for many.",
  "vocabulary.subject": "Your name for what a player makes or works on, such as a piece. Give the app a word for one and a word for many.",
  "vocabulary.finalize": "The action word on the button that closes a turn, such as Fire or Finish.",
  "tables.*.resolution":
    "Lookup selects a roll range; bands compare a total with thresholds. Keyed selects by name; opposed counts how many challenge dice the action total beats.",
  "tables.*.roll": "Enter the dice to roll for this table, such as d6 or 2d6. The result selects an entry.",
  "tables.*.entries[].range": "Set the lowest and highest rolls that select this entry, including both endpoints.",
  "tables.*.entries[].points":
    "In moderated play, points make this result a challenge the moderator can award; without points, it is an effect for everyone.",
  "tables.*.entries[].needs": "Choose what this result depends on. When a run lacks one of these, it draws again.",
  "phases[].steps[].kind":
    "Roll on a table, name a subject, do manual work, run actions, or close the turn. Choose what happens at this point in the flow.",
  "phases[].steps[].closesUnit": "Finishing this manual step also closes the turn. Its checklist serves as the closing check.",
  "modes.*.seeded": "Ask players for a shared seed before starting. The same seed repeats the same sequence of dice results.",
  "license.redistributable":
    "Let the pack's rules text travel in shared exports. When off, exports share results and references without the rules prose.",
  "license.tablePlays": "Let invited players take seats using the owner's copy. When off, invitations let people watch instead of play.",
  defaultMode: "Choose the mode players see first when they set up a session.",
};

/**
 * Convert ordinary concrete paths to schema map/array paths. Map keys may
 * themselves contain dots; their controls pass an explicit schemaPath rather
 * than guessing which dot separates a key from a property.
 */
export function schemaPath(path: string): string {
  return path.replace(/\[\d+\]/g, "[]").replace(/^(tables|modes)\.[^.]+(?=\.|$)/, "$1.*");
}

export function help(path: string): string | null {
  const key = schemaPath(path);
  return Object.hasOwn(HELP, key) ? HELP[key]! : null;
}
