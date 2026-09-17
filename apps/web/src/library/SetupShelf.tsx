import { useCallback, useEffect, useState } from "react";
import { loadSetupText, whichKind, type Setup } from "@runlog/rules-schema";
import { forgetSetup, listSetups, saveSetup, type StoredSetup } from "../storage/db.ts";
import { shippedSetups } from "../control/setups.ts";
import { Disclosure } from "../ui/Disclosure.tsx";

/**
 * The setups somebody keeps.
 *
 * Seven ship with the app and are read from the bundle; those are not
 * here, and cannot be taken off the shelf, because they are not on it.
 * This is everything else: a file somebody was handed, or, once setups
 * are listed, something taken from the marketplace.
 *
 * It is on the library screen rather than in a run's settings because
 * that is what it is: a shelf, next to the shelf of packs, holding the
 * other kind of document this app reads. It folds, and stays folded, for
 * anybody who keeps none: the packs above it are what the page is for.
 */
export function SetupShelf() {
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
    const text = await file.text();
    const format = /\.json$/i.test(file.name) ? "json" : "yaml";

    /*
     * Which kind of file is this? A person choosing a file has no reason
     * to know that a pack and a setup are different documents, and being
     * told "that is not a setup" about a perfectly good pack is unhelpful
     * where the app can say what it *is*.
     */
    const which = whichKind(text, format);
    if (which === "pack") {
      setNote(`${file.name} is a pack, not a setup. Packs go on the shelf above, under Add a pack.`);
      return;
    }

    const parsed = loadSetupText(text, format);
    if (!parsed.ok) {
      const first = parsed.diagnostics.find((d) => d.level === "error");
      setNote(first ? `${file.name} did not load: ${first.path ? `${first.path}: ` : ""}${first.message}` : `${file.name} did not load.`);
      return;
    }

    const setup = parsed.setup;
    const at = new Date().toISOString();
    const had = kept.find((k) => k.id === setup.id);
    await saveSetup({
      id: setup.id,
      title: setup.title,
      version: setup.version,
      tool: setup.tool,
      ...(setup.description ? { description: setup.description } : {}),
      ...(setup.author ? { author: setup.author } : {}),
      source: text,
      format,
      importedAt: had?.importedAt ?? at,
      updatedAt: at,
    });
    await reload();
    setNote(
      had
        ? `${setup.title} is now version ${setup.version}.`
        : `${setup.title} is on your shelf; runs of any pack for ${setup.tool} can be started under it.`,
    );
  };

  const drop = async (setup: StoredSetup) => {
    await forgetSetup(setup.id);
    await reload();
    setNote(`${setup.title} is off the shelf. A run already played under it keeps what it was given.`);
  };

  return (
    <Disclosure className="setupShelf" summary="Your setups" remember="setupShelf">
      <p className="muted small">
        What a tool attached to the game is set to while a run lasts, and what you start holding. A setup is written for a tool rather than
        for a pack, so one fits every pack for the same game.
      </p>

      {kept.length === 0 ? (
        <p className="muted small">
          None of your own yet.{" "}
          {shipped.length > 0 && `${shipped.length} ship with the app and are offered wherever they fit, whether or not anything is here.`}
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
        <span className="muted small">A file with the same id replaces the one here, and keeps the date it first arrived.</span>
      </div>

      {note && <p className="notice">{note}</p>}
    </Disclosure>
  );
}
