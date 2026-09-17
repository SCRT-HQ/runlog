import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "../ui/useConfirm.tsx";
import YAML from "yaml";
import { parsePack, type Diagnostic, type Pack } from "@runlog/rules-schema";
import { blankPack, DRAFT_ID, isBlank, packFilename, type Draft } from "./draft.ts";
import { loadDraft, saveDraft } from "../storage/db.ts";
import { describeLength, encodePackLink } from "../share/link.ts";
import { StartFrom } from "./StartFrom.tsx";
import { SignPanel } from "./SignPanel.tsx";
import { DocsPanel } from "./DocsPanel.tsx";
import { StructurePanel } from "./StructurePanel.tsx";
import { Identity, Requirements, Vocabulary } from "./sections/Overview.tsx";
import { Tables } from "./sections/TablesSection.tsx";
import { Phases } from "./sections/FlowSection.tsx";
import { Modes } from "./sections/ModesSection.tsx";
import { Problems } from "./sections/TestSection.tsx";
import { License } from "./sections/PublishSection.tsx";
import { str } from "./sections/shared.ts";
import { useTitle } from "../title.ts";

/**
 * Writing a pack without writing YAML.
 *
 * The format is meant to be contributable, and "learn our YAML schema first"
 * is where most contributable formats quietly stop being contributable. This
 * is the same document, edited through fields.
 *
 * Two things make it cheaper than it looks. The linter already produces
 * structured diagnostics with dotted paths, so each problem attaches to the
 * field that caused it rather than needing its own validation. And the schema
 * already documents itself, so the help under every field is the schema's own
 * sentence rather than a second copy of it.
 *
 * It edits the draft freely and validates alongside. An editor that refuses
 * your keystrokes until the document is correct is one nobody finishes a
 * document in.
 *
 * The panels themselves live under `sections/`, one file per part of the
 * editor. This file owns the one draft they all read and the one `edit`
 * they all write through.
 */

/** Set a value at a path, cloning the way down. Never mutates the argument. */
function put(draft: Draft, path: (string | number)[], value: unknown): Draft {
  if (path.length === 0) return value as Draft;
  const [head, ...rest] = path;
  if (typeof head === "number") {
    const list = Array.isArray(draft) ? [...(draft as unknown[])] : [];
    list[head] = rest.length === 0 ? value : put((list[head] ?? {}) as Draft, rest, value);
    return list as unknown as Draft;
  }
  const next: Draft = { ...draft };
  next[head!] = rest.length === 0 ? value : put((next[head!] ?? {}) as Draft, rest, value);
  return next;
}

export function DesignView({ onTest }: { onTest?: (pack: Pack) => void } = {}) {
  useTitle("Design");
  // Replacing a draft is not undoable, so it is asked first; see useConfirm.
  const { dialog, ask } = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [droppedSignature, setDroppedSignature] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Whether to ask "which pack?" before showing the editor at all. Set once,
  // from what loaded, and never persisted: the choice is for this visit.
  const [atDoor, setAtDoor] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadDraft(DRAFT_ID).then((stored) => {
      const loaded = (stored?.pack as Draft | undefined) ?? blankPack();
      setDraft(loaded);
      setAtDoor(!isBlank(loaded));
    });
  }, []);

  /** Replace the whole draft, keeping the saved copy in step. */
  const replace = useCallback((next: Draft) => {
    setDraft(next);
    setProblem(null);
    setDroppedSignature(false);
    void saveDraft({ id: DRAFT_ID, pack: next, updatedAt: new Date().toISOString() });
  }, []);

  /**
   * Open a pack that already exists.
   *
   * The point of an editor for a data format is usually the second edit, not
   * the first: fixing a table in something you shipped, or starting from a
   * pack close to what you want. Parsed as YAML, which also reads JSON, and
   * kept as the raw document rather than the validated one, so a pack with a
   * problem in it opens *so you can fix the problem* instead of being refused
   * at the door.
   */
  const open = useCallback(
    async (chosen: File | undefined) => {
      if (!chosen) return;
      let parsed: unknown;
      try {
        parsed = YAML.parse(await chosen.text());
      } catch (e) {
        // Only the first line: a YAML parser's full complaint includes a
        // source excerpt that is unreadable squeezed into a notice.
        const why = e instanceof Error ? e.message.split(/\r?\n/)[0] : "";
        setProblem(`${chosen.name} is not readable as YAML or JSON. ${why}`);
        return;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setProblem(`${chosen.name} does not contain a pack.`);
        return;
      }
      replace(parsed as Draft);
    },
    [replace],
  );

  const edit = useCallback((path: (string | number)[], value: unknown) => {
    setDraft((prev) => {
      if (!prev) return prev;
      let next = put(prev, path, value);

      // An edited pack is no longer the one its author signed, and a stale
      // signature is worse than none: it makes an honest edit look like
      // tampering to everyone who opens it. So the signature comes off the
      // moment the pack changes, and is said out loud rather than done
      // quietly: re-signing is a deliberate act with a private key.
      if (next.signature) {
        const { signature: _dropped, ...rest } = next;
        next = rest;
        setDroppedSignature(true);
      }

      void saveDraft({ id: DRAFT_ID, pack: next, updatedAt: new Date().toISOString() });
      return next;
    });
  }, []);

  const result = useMemo(() => (draft ? parsePack(draft) : null), [draft]);
  const diagnostics: Diagnostic[] = result?.diagnostics ?? [];
  const errors = diagnostics.filter((d) => d.level === "error");
  const warnings = diagnostics.filter((d) => d.level === "warning");

  const download = () => {
    if (!draft) return;
    const text = YAML.stringify(draft, { lineWidth: 90 });
    const url = URL.createObjectURL(new Blob([text], { type: "text/yaml;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = packFilename(draft);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  if (!draft) {
    return (
      <main className="main">
        <section className="panel muted">Opening your draft…</section>
      </main>
    );
  }

  if (atDoor) {
    return (
      <main className="main design">
        {dialog}
        <section className="hero runHero">
          <div>
            <h2>Which pack?</h2>
            <p className="muted">The Designer opens on whatever you were last writing.</p>
          </div>
        </section>
        <section className="panel">
          <div className="headerActions">
            <button className="primary" onClick={() => setAtDoor(false)}>
              Continue editing {str(draft.title) || "Untitled"}
            </button>
            <button
              className="ghost"
              onClick={() => {
                void ask({
                  ask: "Start a new pack?",
                  detail: "The draft you have open is replaced.",
                  confirm: "Start a new one",
                  destructive: true,
                }).then((yes) => {
                  if (!yes) return;
                  replace(blankPack());
                  setAtDoor(false);
                });
              }}
            >
              New pack
            </button>
          </div>
        </section>
      </main>
    );
  }

  const props = { draft, diagnostics, edit };

  return (
    <main className="main design">
      {dialog}
      <section className="hero runHero">
        <div>
          <h2>{str(draft.title) || "Untitled"}</h2>
          <p className="muted">
            {str(draft.id)} · v{str(draft.version)}
            {errors.length === 0 ? (
              <span className="chip ok"> loads</span>
            ) : (
              <span className="chip warn">
                {" "}
                {errors.length} {errors.length === 1 ? "error" : "errors"}
              </span>
            )}
            {warnings.length > 0 && <span className="chip"> {warnings.length} to look at</span>}
          </p>
        </div>
        <div className="headerActions">
          <button
            className="ghost"
            onClick={() => {
              void ask({
                ask: "Start again from a blank pack?",
                detail: "The draft you have open is replaced.",
                confirm: "Start again",
                destructive: true,
              }).then((yes) => yes && replace(blankPack()));
            }}
          >
            New pack
          </button>
          <button className="ghost" onClick={() => file.current?.click()}>
            Open a file…
          </button>
          <button className="ghost" onClick={() => setStarting((s) => !s)}>
            Start from a pack…
          </button>
          <input
            ref={file}
            type="file"
            accept=".yaml,.yml,.json"
            className="hiddenInput"
            onChange={(e) => {
              void open(e.target.files?.[0]);
              // Cleared so choosing the same file twice fires again: the
              // obvious thing to do after editing it outside the app.
              e.target.value = "";
            }}
          />
          {onTest && (
            <button
              className="ghost"
              disabled={!result?.ok || errors.length > 0}
              onClick={() => result?.ok && onTest(result.pack)}
              title={
                errors.length > 0
                  ? "Fix the problems first; a pack with errors cannot be played"
                  : "Play this draft in a run that is not saved"
              }
            >
              Try it
            </button>
          )}
          <button className="ghost" onClick={download}>
            {saved ? "saved" : `Download ${packFilename(draft)}`}
          </button>
          <button
            className="ghost"
            onClick={() => {
              void (async () => {
                const made = await encodePackLink(draft);
                setLink(made);
                try {
                  await navigator.clipboard?.writeText(made);
                } catch {
                  // No clipboard permission: the link is shown below to copy
                  // by hand, so this is not worth interrupting anyone about.
                }
              })();
            }}
          >
            Copy a link
          </button>
        </div>
      </section>

      {problem && <div className="notice">{problem}</div>}

      {starting && (
        <StartFrom
          onPick={(doc) => {
            replace(doc as Draft);
            setStarting(false);
          }}
          onClose={() => setStarting(false)}
        />
      )}

      {link && (
        <div className="notice shareNotice">
          <div>
            <strong>Copied.</strong> The whole pack is inside that link, it goes nowhere near a server, so anyone you send it to has your
            game and nothing in between has seen it.
          </div>
          <div className={describeLength(link).ok ? "muted small" : "warnText"}>{describeLength(link).text}</div>
          <input className="textInput mono" readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="ghost tiny" onClick={() => setLink(null)}>
            done
          </button>
        </div>
      )}

      {droppedSignature && (
        <div className="notice">
          This pack was signed, and your edit removed the signature, it no longer describes what is in the file. Sign the pack again when
          you are finished: <code>runlog sign {packFilename(draft)} --key your-key.json</code>
        </div>
      )}

      <div className="columns">
        <div className="col wide">
          <Identity {...props} />
          <Requirements {...props} />
          <Vocabulary {...props} />
          <Tables {...props} />
          <Phases {...props} />
          <Modes {...props} />
        </div>
        <div className="col">
          <Problems diagnostics={diagnostics} />
          <License {...props} />
          <SignPanel draft={draft} pack={result?.ok ? result.pack : null} loads={errors.length === 0} />
          <DocsPanel pack={result?.ok ? result.pack : null} />
          {result?.ok && <StructurePanel pack={result.pack} warnings={result.diagnostics} random={() => Math.random} />}
        </div>
      </div>
    </main>
  );
}
