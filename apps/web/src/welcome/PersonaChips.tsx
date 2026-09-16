import { PERSONAS, type Persona } from "./personas.ts";

/**
 * Whose run the log beside the headline is: one small button per persona.
 *
 * The example is always some particular game, and a reader who does not
 * recognize it should be able to find their own in one press. A row of
 * chips under the log says outright that there is more than one, which
 * the turning word in the old headline had to move to say.
 */
export function PersonaChips({ persona, onChange }: { persona: Persona; onChange: (next: Persona) => void }) {
  return (
    <div className="personaChips" role="group" aria-label="Whose run this is">
      {PERSONAS.map((p) => (
        <button key={p.id} type="button" className="personaChip" aria-pressed={p.id === persona.id} onClick={() => onChange(p)}>
          {p.noun}
        </button>
      ))}
    </div>
  );
}
