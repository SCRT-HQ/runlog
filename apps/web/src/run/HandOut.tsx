import { useEffect, useState } from "react";
import type { Pack, Setup } from "@runlog/rules-schema";
import { builtins } from "../control/builtin.ts";
import { chose, chosenFrom, creditLine, forTool, setupsHere, type ChosenSetup } from "../control/setups.ts";

/**
 * Handing out a setup in the middle of a run.
 *
 * Choosing one belongs where a run starts, and it is there. This is the
 * other thing somebody running a table needs: the run is an hour old,
 * everyone is bored of the gear they started with, and the host decides
 * that from here on it is the heavy build.
 *
 * Two presses rather than one, on purpose. Picking a different setup
 * changes what the next tool to attach is given, which is harmless and
 * reversible. Handing it out gives everybody attached right now the
 * runes and the armor, which is not; a table that has been playing for
 * an hour should not be re-equipped because somebody browsed a list.
 */
export function HandOut({
  pack,
  record,
  onChoose,
  onHandOut,
}: {
  pack: Pack;
  record: { setup?: unknown } | null;
  onChoose: (chosen: ChosenSetup | null) => void | Promise<void>;
  /** Send the word, with what is being handed out; absent when there is no line to send it down. */
  onHandOut?: (chosen: ChosenSetup) => boolean | Promise<boolean>;
}) {
  const [offered, setOffered] = useState<Setup[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const chosen = chosenFrom(record?.setup);

  useEffect(() => {
    let live = true;
    void (async () => {
      const tool = (await builtins()).find((b) => b.pack === pack.id)?.profile.tool;
      const all = await setupsHere();
      if (live) setOffered(forTool(all, tool));
    })();
    return () => {
      live = false;
    };
  }, [pack.id]);

  if (offered.length === 0) return null;

  const v = pack.vocabulary.setup;
  const word = v.one.toLowerCase();
  const gifts = (chosen?.ops ?? []).filter((o) => o.once).length;

  return (
    <>
      <h4 className="stepLabel">{v.one}</h4>
      <p className="muted small">
        What this {pack.vocabulary.run.one.toLowerCase()} is played under. Changing it here changes what the next tool to attach is given;
        handing it out gives it to everyone attached now.
      </p>
      <label className="toggle">
        <span>{v.one}</span>
        <select
          className="chipAdd"
          value={chosen?.from.length === 1 ? (chosen.from[0]?.id ?? "") : ""}
          aria-label={`Which ${word} this ${pack.vocabulary.run.one.toLowerCase()} is played under`}
          onChange={(e) => {
            const picked = offered.find((s) => s.id === e.target.value);
            setNote(null);
            void onChoose(picked ? chose(picked) : null);
          }}
        >
          <option value="">None</option>
          {offered.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      <div className="padRow">
        <button
          className="ghost tiny"
          disabled={!chosen || !onHandOut}
          title={chosen ? undefined : `Pick ${aOr(v.one)} first`}
          onClick={() => {
            if (!onHandOut || !chosen) return;
            void Promise.resolve(onHandOut(chosen)).then((sent) =>
              setNote(
                sent ? `Handed out. Anyone attached has it now.` : "Nothing was sent: this device is not connected to the run right now.",
              ),
            );
          }}
        >
          Hand it out
        </button>
        <span className="muted small">
          {chosen
            ? gifts > 0
              ? `${creditLine(chosen) ?? "This run's terms"}, including ${gifts === 1 ? "one thing that is given" : `${gifts} things that are given`} rather than set. Given again, on purpose.`
              : `${creditLine(chosen) ?? "This run's terms"}. Nothing in it is a gift, so this only reapplies settings.`
            : `Nothing is chosen, so there is nothing to hand out.`}
        </span>
      </div>
      {note && <p className="notice">{note}</p>}
    </>
  );
}

/** "a Loadout" or "an Outfit", for a title that could be either. */
function aOr(word: string): string {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word.toLowerCase()}`;
}
