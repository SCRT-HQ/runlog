import { useEffect, useState } from "react";
import type { Pack, Setup } from "@runlog/rules-schema";
import { builtins } from "../control/builtin.ts";
import { chose, forTool, shippedSetups, type ChosenSetup } from "../control/setups.ts";

/**
 * Choosing what you start with, where the run starts.
 *
 * A setup is the difference between two runs of the same pack: one
 * player begins bare-handed and another begins in a knight's armor, and
 * the dice do exactly the same things to both. That is a choice about
 * this run, so it is made where the run is made, beside the mode, and
 * not somewhere in a settings dialog behind it.
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
      const tool = (await builtins()).find((b) => b.pack === pack.id)?.profile.tool;
      const all = await shippedSetups();
      if (live) setOffered(forTool(all, tool));
    })();
    return () => {
      live = false;
    };
  }, [pack.id]);

  if (offered.length === 0) return null;

  const v = pack.vocabulary.setup;
  const word = v.one.toLowerCase();

  return (
    <>
      <h3 className="sectionTitle">
        {v.one} <span className="muted">optional</span>
      </h3>
      <p className="muted small">
        What the game is set to, and what you start holding, once a tool is attached. It changes what this {pack.vocabulary.run.one.toLowerCase()} is like
        to play without changing a thing about what the dice can do.
      </p>
      <div className="choices">
        <button className={`choice ${chosen ? "" : "on"}`} onClick={() => onChoose(null)}>
          <strong>None</strong>
          <span className="muted small">Start as the game would have you start.</span>
        </button>
        {offered.map((setup) => (
          <button key={setup.id} className={`choice ${chosen?.id === setup.id ? "on" : ""}`} onClick={() => onChoose(chose(setup))}>
            <strong>{setup.title}</strong>
            <span className="muted small">{setup.description}</span>
          </button>
        ))}
      </div>
      <p className="muted small">
        A {word} needs a tool attached to do anything. With none attached it is simply not applied, and the {pack.vocabulary.run.one.toLowerCase()} plays as
        it always has.
      </p>
    </>
  );
}
