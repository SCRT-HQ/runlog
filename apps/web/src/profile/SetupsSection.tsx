import { useCallback, useEffect, useState } from "react";
import { type Setup } from "@runlog/rules-schema";
import { forgetSetup, listSetups, type StoredSetup } from "../storage/db.ts";
import { keepSetup, readDocumentFile } from "../storage/documents.ts";
import { shippedSetups } from "../control/setups.ts";

/**
 * The setups somebody keeps.
 *
 * Seven ship with the app and are read from the bundle; those are not
 * here, and cannot be taken off the shelf, because they are not on it.
 * This is everything else: a file somebody was handed, or, once setups
 * are listed, something taken from the marketplace.
 *
 * It sits under Settings, with the rest of what somebody keeps rather
 * than plays. It was on the library screen, where it was the last panel
 * of a page about packs and stood between somebody and the run they came
 * for. Managing the files is an errand, and errands live in settings; the
 * setups that fit a run are still offered in session setup, which is
 * where the choice actually gets made.
 *
 * Nothing here reaches the game. Keeping a setup writes a document to
 * this device and stops; a run is what applies one.
 */
export function SetupsSection() {
  const [kept, setKept] = useState<StoredSetup[]>([]);
  const [shipped, setShipped] = useState<Setup[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(async () => setKept(await listSetups()), []);

  useEffect(() => {
    void reload();
    void shippedSetups().then(setShipped, () => {});
  }, [reload]);

  const take = async (file: File | undefined) => {
    if (!file) return;
    setNote(null);
    const doc = await readDocumentFile(file);

    /*
     * Which kind of file is this? A person choosing a file has no reason
     * to know that a pack and a setup are different documents, and being
     * told "that is not a setup" about a perfectly good pack is unhelpful
     * where the app can say what it *is*.
     */
    if (doc.kind === "pack") {
      setNote(`${file.name} is a pack, not a setup. Packs go on the library page, under Add and discover.`);
      return;
    }

    const result = await keepSetup(doc.text, doc.format, file.name);
    if (!result.ok) {
      setNote(result.message);
      return;
    }

    await reload();
    const setup = result.setup;
    setNote(
      result.replaced
        ? `${setup.title} is now version ${setup.version}.`
        : `${setup.title} is on your shelf; runs of any pack for ${setup.tool} can be started under it.`,
    );
  };

  const drop = async (setup: StoredSetup) => {
    await forgetSetup(setup.id);
    await reload();
    setNote(`${setup.title} was removed. Existing runs keep their setup.`);
  };

  return (
    <section className="panel setups">
      <h3 className="sectionTitle">Setups</h3>
      <p className="muted small">
        A setup configures a connected tool and the player's starting state during a run. It is written for a tool, so it works with every
        pack for the same game.
      </p>

      {kept.length === 0 ? (
        <p className="muted small">
          No imported setups yet. {shipped.length > 0 && `${shipped.length} are included with the app and available for compatible packs.`}
        </p>
      ) : (
        <ul className="runList">
          {kept.map((s) => (
            <li key={s.id} className="runRow">
              <span className="runRowMain">
                <strong>{s.title}</strong>
                <span className="muted small">
                  {s.tool} · {s.version}
                  {s.description ? ` · ${s.description}` : ""}
                </span>
              </span>
              <button className="ghost tiny" onClick={() => void drop(s)} title={`Take ${s.title} off the shelf`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="padRow">
        <label className="ghost fileButton">
          Load a setup from a file
          <input type="file" accept=".yaml,.yml,.json" onChange={(e) => void take(e.target.files?.[0])} />
        </label>
        <span className="muted small">Importing a file with the same ID replaces the setup and preserves its original import date.</span>
      </div>

      {note && <p className="notice">{note}</p>}
    </section>
  );
}
