import { useEffect, useId, useRef, useState } from "react";
import { PERSONAS, article, type Persona } from "./personas.ts";

/**
 * The word in the heading that says who the page is for.
 *
 * It turns over on its own every few seconds until someone reaches for
 * it, so a reader who does nothing sees that it can be anyone. Reaching
 * for it (a pointer over it, focus on it) holds it still, so it is never
 * a moving target; a click opens the list of everyone it can be, and the
 * arrow keys turn it one at a time. The old word slides up and out while
 * the new one slides in beneath, unless the reader has asked for less
 * motion, in which case it simply changes.
 */
export function PersonaSwitcher({ persona, onChange }: { persona: Persona; onChange: (next: Persona) => void }) {
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const [touched, setTouched] = useState(false);
  const [leaving, setLeaving] = useState<Persona | null>(null);
  const previous = useRef(persona);
  const listId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);

  const stillness = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The word that was there slides out while the new one slides in.
  useEffect(() => {
    if (previous.current.id === persona.id) return;
    const was = previous.current;
    previous.current = persona;
    if (stillness) return;
    setLeaving(was);
    const t = setTimeout(() => setLeaving(null), 420);
    return () => clearTimeout(t);
  }, [persona, stillness]);

  // On its own, until someone reaches for it or has chosen; never for
  // someone who asked for stillness.
  useEffect(() => {
    if (touched || held || open || stillness) return;
    const t = setInterval(() => onChange(after(persona)), 3800);
    return () => clearInterval(t);
  }, [persona, touched, held, open, stillness, onChange]);

  // The list closes on a click elsewhere or on Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const pick = (next: Persona) => {
    setTouched(true);
    setOpen(false);
    onChange(next);
  };

  return (
    <span
      className="persona"
      ref={rootRef}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      {article(persona.noun)}{" "}
      <button
        type="button"
        className="personaWord"
        title="Someone else? Choose who you are"
        aria-label={`${persona.noun}. Choose who you are`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setTouched(true);
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowRight") {
            e.preventDefault();
            pick(after(persona));
          } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
            e.preventDefault();
            pick(before(persona));
          }
        }}
      >
        <span className="personaRoll">
          {leaving && (
            <span className="personaLeaving" key={leaving.id} aria-hidden="true">
              {leaving.noun}
            </span>
          )}
          <span className={leaving ? "personaArriving" : undefined} key={persona.id}>
            {persona.noun}
          </span>
        </span>
        <svg className="personaMore" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className="personaList" role="listbox" id={listId} aria-label="Who you are">
          {PERSONAS.map((p) => (
            <li key={p.id} role="option" aria-selected={p.id === persona.id}>
              <button type="button" onClick={() => pick(p)}>
                <span className="personaListNoun">
                  {article(p.noun)} {p.noun}
                </span>
                <span className="personaListPack">{p.packTitle}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

function after(persona: Persona): Persona {
  const i = PERSONAS.findIndex((p) => p.id === persona.id);
  return PERSONAS[(i + 1) % PERSONAS.length]!;
}

function before(persona: Persona): Persona {
  const i = PERSONAS.findIndex((p) => p.id === persona.id);
  return PERSONAS[(i - 1 + PERSONAS.length) % PERSONAS.length]!;
}
