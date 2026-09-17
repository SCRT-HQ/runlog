import type { Offer } from "../run/offer.ts";
import type { SeatKind } from "../run/seats.ts";
import { IconButton } from "../ui/IconButton.tsx";

/**
 * What a seated player may press, from the offer the run's own page
 * published. The same list the page shows its owner, less what belongs to
 * the host: no undo, no setup, no clock, no dice setting and no ending.
 *
 * The primary and the moves are the table's actions, so they are drawn
 * only where a seat takes them: a table pack. On a solo or a moderated
 * pack the one acting seat is the host's, and what is left for a seat is
 * the step's own answer, the tallies and the dials.
 */
export function SeatStrip({
  offer,
  seating,
  held,
  note,
  onPress,
}: {
  offer: Offer | undefined;
  seating: SeatKind;
  /** Whether a device is holding the run, so a press has somewhere to land. */
  held: boolean;
  /** What came back from the last press. */
  note: string | null;
  onPress: (p: { press: string; move?: string; answer?: Record<string, unknown> }) => void;
}) {
  if (!offer) return <section className="panel seatStrip">Loading…</section>;
  const acts = seating === "table";
  const suggestions = offer.presets.find((p) => p.kind === "declareSubject")?.suggestions ?? [];
  const ticking = offer.presets.some((p) => p.kind === "checklist");
  return (
    <section className="panel seatStrip">
      <h3 className="sectionTitle">Your seat</h3>
      {!held && <p className="muted small">Waiting for the run to be opened.</p>}
      {held && offer.needsPage && !offer.primary && <p className="muted small">{offer.needsPage}</p>}
      {acts && offer.primary && (
        <button className="primary" disabled={!held} onClick={() => onPress({ press: "primary" })}>
          {offer.primary.label}
        </button>
      )}
      {acts && offer.moves.length > 0 && (
        <div className="padRow">
          {offer.moves.map((m) => (
            <button key={m.id} className="ghost small" disabled={!held} onClick={() => onPress({ press: "move", move: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="padRow">
          {suggestions.map((s) => (
            <button key={s} className="ghost small" disabled={!held} onClick={() => onPress({ press: "answer", answer: { subject: s } })}>
              {s}
            </button>
          ))}
        </div>
      )}
      {ticking && (
        <button className="ghost small" disabled={!held} onClick={() => onPress({ press: "answer", answer: { ticks: "all" } })}>
          Tick everything
        </button>
      )}
      {offer.trackers.length > 0 && (
        <div className="seatTrackers">
          {offer.trackers.map((t) => (
            <div key={t.id} className="seatTracker">
              <span>{t.label}</span>
              <IconButton
                disabled={!held}
                label={`${t.label} down one`}
                onClick={() => onPress({ press: "answer", answer: { tracker: t.id, by: -1 } })}
              >
                −
              </IconButton>
              <span className="num">{t.value}</span>
              <IconButton
                disabled={!held}
                label={`${t.label} up one`}
                onClick={() => onPress({ press: "answer", answer: { tracker: t.id, by: 1 } })}
              >
                +
              </IconButton>
            </div>
          ))}
        </div>
      )}
      {note && <p className="muted small">{note}</p>}
    </section>
  );
}
