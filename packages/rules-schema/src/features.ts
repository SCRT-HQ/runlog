/**
 * How a pack plays, read off its modes and capabilities.
 *
 * A catalog filters on these, and so does the card a publisher's listing
 * shows, so they are computed in one place from the pack's own head —
 * never typed by an author — and a filter can never disagree with the
 * rules. Both the app and the seeding script use this; the API stores
 * what they send and computes nothing.
 */

export type Feature = "solo" | "together" | "moderated" | "seeded" | "endless" | "timers" | "cards" | "journal" | "reachesBack";

export const FEATURES: ReadonlyArray<{ id: Feature; label: string; what: string }> = [
  { id: "solo", label: "Solo", what: "Has a mode for one person." },
  { id: "together", label: "Together", what: "Has a mode for several people at one table, taking turns." },
  { id: "moderated", label: "Moderated", what: "One person runs it; a roster races the draws and is awarded points." },
  { id: "seeded", label: "Seeded", what: "Has a mode that rolls from a shared seed, so everyone meets the same run." },
  { id: "endless", label: "Endless", what: "Has a mode with no end but the one you choose." },
  { id: "timers", label: "Timers", what: "Starts clocks." },
  { id: "cards", label: "Cards", what: "Deals from a deck." },
  { id: "journal", label: "Journal", what: "Keeps a line of notes per unit." },
  { id: "reachesBack", label: "Reaches back", what: "Consequences can land on something you already finished." },
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The features a pack's raw head declares, and the most people any mode seats. */
export function featuresOf(head: Record<string, unknown>): { features: Feature[]; players: number } {
  const found = new Set<Feature>();
  let players = 1;
  const modes = isRecord(head["modes"]) ? Object.values(head["modes"]) : [];
  for (const m of modes) {
    if (!isRecord(m)) continue;
    const moderated = isRecord(m["moderated"]) ? m["moderated"] : m["moderated"] ? {} : null;
    const seats = isRecord(m["players"]) ? Number(m["players"]["max"] ?? 1) : 1;
    if (moderated) {
      found.add("moderated");
      const c = isRecord(moderated["contestants"]) ? Number(moderated["contestants"]["max"] ?? 10) : 10;
      players = Math.max(players, c + 1);
    } else if (seats > 1) {
      found.add("together");
      players = Math.max(players, seats);
    } else found.add("solo");
    if (m["seeded"] === true) found.add("seeded");
    const units = isRecord(m["units"]) ? m["units"] : null;
    if (units && Number(units["max"] ?? 0) >= 99) found.add("endless");
  }
  const caps = Array.isArray(head["capabilities"]) ? head["capabilities"].map(String) : [];
  if (caps.includes("timers")) found.add("timers");
  if (caps.includes("decks") || caps.includes("standardDeck")) found.add("cards");
  const journal = head["journal"];
  if (caps.includes("journal") && !(isRecord(journal) && journal["enabled"] === false)) found.add("journal");
  const targeting = head["targeting"];
  if (isRecord(targeting) && targeting["strategy"] && targeting["strategy"] !== "none") found.add("reachesBack");
  return { features: FEATURES.map((f) => f.id).filter((f) => found.has(f)), players };
}

/** A price as the catalog shows it. */
export function priceDisplay(price: "free" | { amount: number; currency: string }): string {
  if (price === "free") return "free";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency.toUpperCase() }).format(price.amount / 100);
  } catch {
    return `${(price.amount / 100).toFixed(2)} ${price.currency.toUpperCase()}`;
  }
}
