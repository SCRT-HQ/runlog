import { useEffect, useMemo, useRef, useState } from "react";
import type { Pack, Setup } from "@runlog/rules-schema";
import { builtins } from "../control/builtin.ts";
import { catalogFor, type ToolCatalog } from "../control/catalog.ts";
import { listsFor, type Lists } from "../control/lists.ts";
import { asProfileOps, asSetupOps, combine, creditLine, edit, forTool, setupsHere, type ChosenSetup } from "../control/setups.ts";
import { Ops } from "./Ops.tsx";

/**
 * Choosing what you start with, where the run starts.
 *
 * A setup is the difference between two runs of the same pack: one
 * player begins bare-handed and another begins in a knight's armor, and
 * the dice do exactly the same things to both. That is a choice about
 * this run, so it is made where the run is made, beside the mode, and
 * not somewhere in a settings dialog behind it.
 *
 * Three things happen here, in the order somebody does them. Several
 * setups can be chosen rather than one, because "a knight's armor" and
 * "enough smithing stones to use it" are two different sentences and
 * wanting both is the ordinary case. What they hand over is then shown
 * as a list, which is the same editor the settings dialog uses for a
 * run's terms. And the list can be changed, because a setup that is
 * almost right is more common than one that is exactly right, and the
 * alternative is starting the run and then fixing it.
 *
 * Nothing here is shown unless there is something to show. A pack whose
 * game has no tool attached to it, or a tool nobody has written a setup
 * for, gets no section and no explanation of a section it does not have.
 */
export function SetupPicker({
  pack,
  chosen,
  onChoose,
}: {
  pack: Pack;
  chosen: ChosenSetup | null;
  onChoose: (chosen: ChosenSetup | null) => void;
}) {
  const [offered, setOffered] = useState<Setup[]>([]);
  const [tool, setTool] = useState<string | undefined>(undefined);
  const [lists, setLists] = useState<Lists>({});
  const [open, setOpen] = useState(false);

  /**
   * A menu is a thing that closes. Escape, and a press anywhere outside
   * it, because one that only closes by pressing the button that opened
   * it is a panel wearing a menu's clothes.
   */
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  useEffect(() => {
    let live = true;
    void (async () => {
      /*
       * Which tool, when the run does not exist yet and so has no profile
       * of its own to ask? The one the pack's shipped profile names. It is
       * the only signal there is at this point, and it is the right one
       * for every pack that ships with a profile; a pack whose owner
       * imported their own profile for some other tool will see this
       * section once the run has started and they have loaded it.
       */
      const named = (await builtins()).find((b) => b.pack === pack.id)?.profile.tool;
      const all = await setupsHere();
      if (!live) return;
      setTool(named);
      setOffered(forTool(all, named));
      if (named) setLists(await listsFor(named));
    })();
    return () => {
      live = false;
    };
  }, [pack.id]);

  /** Which setups are ticked, by id, in the order they were ticked. */
  const picked = useMemo(() => (chosen?.from ?? []).map((f) => f.id), [chosen]);

  /**
   * What the ticked setups hand over, before anything was done to it.
   *
   * Recomputed from the setups rather than remembered, so it is the
   * thing `edit` compares against to work out whether the list in front
   * of the player is still theirs or has been changed.
   */
  const seeded = useMemo(
    () => combine(picked.map((id) => offered.find((s) => s.id === id)).filter((s): s is Setup => s !== undefined))?.ops ?? [],
    [picked, offered],
  );

  const catalog: ToolCatalog | null = tool ? catalogFor(tool) : null;

  if (offered.length === 0) return null;

  const v = pack.vocabulary.setup;
  const word = v.one.toLowerCase();
  const run = pack.vocabulary.run.one.toLowerCase();

  /** Tick or untick one, keeping whatever the player had already edited. */
  const toggle = (setup: Setup) => {
    const next = picked.includes(setup.id) ? picked.filter((id) => id !== setup.id) : [...picked, setup.id];
    const setups = next.map((id) => offered.find((s) => s.id === id)).filter((s): s is Setup => s !== undefined);
    onChoose(combine(setups));
  };

  const credit = creditLine(chosen);

  return (
    <>
      <h3 className="sectionTitle">
        {v.one} <span className="muted">optional</span>
      </h3>
      <p className="muted small">
        What the game is set to, and what you start holding, once a tool is attached. The dice do the same either way.
      </p>

      <div className="setupMenu" ref={menu}>
        <button className="chipAdd setupSummary" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(!open)}>
          <span className="setupSummaryText">{credit ?? `Choose ${aOr(v.one)}`}</span>
          <span className="caret">{open ? "▴" : "▾"}</span>
        </button>

        {open && (
          <div className="setupPanel" role="listbox" aria-multiselectable="true" aria-label={`Which ${word}`}>
            <button className="setupOption" role="option" aria-selected={picked.length === 0} onClick={() => onChoose(null)}>
              <span className="tick">{picked.length === 0 ? "✓" : ""}</span>
              <span className="setupOptionText">
                <strong>None</strong>
                <span className="muted small">Start as the game would have you start.</span>
              </span>
            </button>
            {offered.map((setup) => (
              <button
                key={setup.id}
                className="setupOption"
                role="option"
                aria-selected={picked.includes(setup.id)}
                onClick={() => toggle(setup)}
              >
                <span className="tick">{picked.includes(setup.id) ? "✓" : ""}</span>
                <span className="setupOptionText">
                  <strong>{setup.title}</strong>
                  <span className="muted small">{setup.description}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <h4 className="stepLabel">What that hands over</h4>
      {picked.length > 1 && <p className="muted small">In the order you picked them. Where two say the same thing, the last one wins.</p>}
      {picked.length === 0 && <p className="muted small">Nothing yet. Pick one above, or add a line of your own.</p>}
      <Ops
        catalog={catalog}
        lists={lists}
        ops={asProfileOps(chosen?.ops ?? [])}
        onChange={(ops) => onChoose(edit(chosen, asSetupOps(ops), seeded))}
        addLabel={`Add custom ${word}`}
      />

      <p className="muted small">With no tool attached, none of it is applied and the {run} plays as it always has.</p>
    </>
  );
}

/** "a Loadout" or "an Outfit", for a label that could be either. */
function aOr(word: string): string {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}
