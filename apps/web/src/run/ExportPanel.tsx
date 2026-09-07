import { useRef, useState } from "react";
import type { Pack } from "@runlog/rules-schema";
import {
  exportRun,
  importRun,
  logFilename,
  mayQuote,
  renderLog,
  type RunEvent,
  type RunState,
} from "@runlog/engine";

/**
 * Taking the run out of the app.
 *
 * The archive is the point: this is a browser app holding the only copy of
 * something that took an evening to make, so getting it onto disk in a form
 * that comes back exactly is not a nice-to-have. The write-up is the Run Log
 * sheet the game already asks you to keep, filled in for you.
 *
 * The license choice is offered here rather than decided quietly, because the
 * player is the one who knows who they are sending it to. The engine enforces
 * whichever they pick.
 */

function download(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoked on the next turn of the loop: revoking synchronously races the
  // download in some browsers and produces an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportPanel({
  pack,
  state,
  events,
  onLoad,
}: {
  pack: Pack;
  state: RunState;
  events: RunEvent[];
  onLoad: (events: RunEvent[]) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  const open = mayQuote(pack, "share");
  /** Whether the write-up is meant for anyone else. Off: the private case. */
  const [share, setShare] = useState(false);
  const audience = share ? "share" : "self";

  const saveArchive = () =>
    download(
      logFilename(pack, state, "json"),
      JSON.stringify(exportRun(pack, events), null, 2),
      "application/json",
    );

  const saveWriteUp = () =>
    download(
      logFilename(pack, state, "md"),
      renderLog(pack, events, { audience }),
      "text/markdown",
    );

  const load = async (chosen: File | undefined) => {
    if (!chosen) return;
    setProblem(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await chosen.text());
    } catch {
      setProblem("That file is not JSON.");
      return;
    }
    const result = importRun(parsed);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    if (result.archive.pack.id !== pack.id) {
      // Replaying one game's log against another's rules would produce
      // confident nonsense, so it is refused rather than attempted.
      setProblem(`That log was played with ${result.archive.pack.title}, not this pack.`);
      return;
    }
    if (result.archive.pack.version !== pack.version) {
      setProblem(
        `Careful: that log was played against v${result.archive.pack.version} and this is v${pack.version}. Loaded anyway.`,
      );
    }
    onLoad(result.archive.events);
  };

  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Take it with you <span className="muted">nothing leaves the machine on its own</span>
      </h3>

      <div className="exportRow">
        <button className="ghost" onClick={saveArchive}>
          Save the log
        </button>
        <span className="muted small">
          The events themselves, as JSON. Comes back exactly; carries no rules text.
        </span>
      </div>

      <div className="exportRow">
        <button className="ghost" onClick={saveWriteUp}>
          Write it up
        </button>
        <span className="muted small">
          The {pack.vocabulary.run.one.toLowerCase()} as a page of Markdown, to keep or to post.
        </span>
      </div>

      <label className="toggle exportToggle" title="Chooses whether the pack's own words travel with it">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
        <span>This copy is for someone else</span>
      </label>
      <p className="muted small">
        {open
          ? `${pack.title} is redistributable, so its text goes either way.`
          : share
            ? `${pack.title} is not redistributable, so the write-up will record which results came up without quoting them.`
            : `${pack.title} is not redistributable. A copy for yourself may quote it; tick the box before sending it on.`}
      </p>

      <div className="exportRow">
        <button className="ghost" onClick={() => setPreview((p) => !p)}>
          {preview ? "Hide" : "Preview"}
        </button>
        <button className="ghost" onClick={() => file.current?.click()}>
          Load a saved log
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          className="hiddenInput"
          onChange={(e) => void load(e.target.files?.[0])}
        />
      </div>

      {problem && <div className="notice">{problem}</div>}

      {preview && <pre className="logPreview">{renderLog(pack, events, { audience })}</pre>}
    </section>
  );
}
