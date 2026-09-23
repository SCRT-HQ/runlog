import { Pick } from "../ui/Pick.tsx";
import { PERSONAS, type Persona } from "./personas.ts";

/**
 * Whose run the example beside the headline is: one small button per persona.
 *
 * The example is always some particular game, and a reader who does not
 * recognize it should be able to find their own in one press. A row of
 * chips under the example says outright that there is more than one. They
 * are plain toggle buttons: pressing one is the only thing that changes
 * whose example it is, and nothing turns them on its own.
 */
export function PersonaChips({ persona, onChange }: { persona: Persona; onChange: (next: Persona) => void }) {
  return (
    <div className="personaChips" role="group" aria-label="Whose run this is">
      {PERSONAS.map((p) => (
        <Pick key={p.id} kind="one" on={p.id === persona.id} className="personaChip" onClick={() => onChange(p)}>
          {p.noun}
        </Pick>
      ))}
    </div>
  );
}
