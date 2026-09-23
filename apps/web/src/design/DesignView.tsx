import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "../ui/useConfirm.tsx";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import { PageHeader } from "../ui/PageHeader.tsx";
import { SeverityGlyph } from "../ui/Severity.tsx";
import YAML from "yaml";
import { parsePack, type Diagnostic, type Pack } from "@runlog/rules-schema";
import { blankPack, DRAFT_ID, isBlank, isPlaceholderId, type Draft } from "./draft.ts";
import { loadDraft, saveDraft } from "../storage/db.ts";
import { addressOf, createSectionFromHash, goTo } from "../route.ts";
import { focusField } from "./fields.tsx";
import { StartFrom } from "./StartFrom.tsx";
import { Overview } from "./sections/Overview.tsx";
import { TablesSection } from "./sections/TablesSection.tsx";
import { FlowSection } from "./sections/FlowSection.tsx";
import { ModesSection } from "./sections/ModesSection.tsx";
import { TestSection } from "./sections/TestSection.tsx";
import { PublishSection } from "./sections/PublishSection.tsx";
import { asSection, countBySection, hashForSection, SECTIONS, type Section } from "./sections/model.ts";
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
 * Six sections, not one page and not a wizard. The panels live under
 * `sections/`, one file each; this file owns the one draft they all read,
 * the one `edit` they all write through, and which section is showing.
 * Nothing about the draft is per-section, which is what makes moving
 * between them free: there is no step to complete and nothing to commit.
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

/** Where the draft stands with storage. Written through on every edit, so this is usually `saved` a moment later. */
type Saving = "saved" | "saving" | "failed";

export function DesignView({ onTest }: { onTest?: (pack: Pack) => void } = {}) {
  useTitle("Design");
  // Replacing a draft is not undoable, so it is asked first; see useConfirm.
  const { dialog, ask } = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [droppedSignature, setDroppedSignature] = useState(false);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState<Saving>("saved");
  const [section, setSection] = useState<Section>(() =>
    asSection(typeof location === "undefined" ? "" : createSectionFromHash(addressOf(location))),
  );
  /** A field the page is on its way to, named by the dotted path a diagnostic carried. */
  const [wanted, setWanted] = useState<string | null>(null);
  // Whether to ask "which pack?" before showing the editor at all. Set once,
  // from what loaded, and never persisted: the choice is for this visit.
  const [atDoor, setAtDoor] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  /** The last thing handed to storage, so a failed write has something to try again with. */
  const unsaved = useRef<Draft | null>(null);
  /** Which write is the current one: an older one finishing late must not report on a newer one. */
  const writes = useRef(0);

  useEffect(() => {
    void loadDraft(DRAFT_ID).then((stored) => {
      const loaded = (stored?.pack as Draft | undefined) ?? blankPack();
      setDraft(loaded);
      setAtDoor(!isBlank(loaded));
    });
  }, []);

  /** Hand the draft to storage and say how that went. No debounce: the write is one row and the editor is one draft. */
  const store = useCallback((next: Draft) => {
    unsaved.current = next;
    const mine = ++writes.current;
    setSaving("saving");
    void Promise.resolve(saveDraft({ id: DRAFT_ID, pack: next, updatedAt: new Date().toISOString() })).then(
      () => {
        if (mine === writes.current) setSaving("saved");
      },
      () => {
        if (mine === writes.current) setSaving("failed");
      },
    );
  }, []);

  /** Replace the whole draft, keeping the saved copy in step. */
  const replace = useCallback(
    (next: Draft) => {
      setDraft(next);
      setProblem(null);
      setDroppedSignature(false);
      store(next);
    },
    [store],
  );

  /** Ask before a replacement throws away work. A draft still as it was made is not work. */
  const askToReplace = useCallback(async () => {
    if (!draft || isBlank(draft)) return true;
    return ask({
      ask: `Replace ${str(draft.title) || "Untitled"}?`,
      detail: "The draft you have open is replaced.",
      confirm: "Replace",
      destructive: true,
    });
  }, [ask, draft]);

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
      // Asked after the file has been read, so the question is only ever
      // put where there is actually a pack ready to take the draft's place.
      if (!(await askToReplace())) return;
      replace(parsed as Draft);
    },
    [askToReplace, replace],
  );

  const edit = useCallback(
    (path: (string | number)[], value: unknown) => {
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

        store(next);
        return next;
      });
    },
    [store],
  );

  /**
   * Show a section.
   *
   * Nothing is re-parsed on the way: every section reads the same draft
   * object and writes through the same `edit`, so a half-typed number, a
   * key the editor has no control for and a value the schema rejects all
   * survive the move exactly as they were. Leaving a section is not
   * saving it, because there was never a copy of it to save.
   */
  const show = useCallback((next: Section) => {
    setSection(next);
    goTo(hashForSection(next), "push");
  }, []);

  // The address is the section: a reload lands on the same one and Back
  // walks the sections the way it walks pages.
  useEffect(() => {
    const follow = () => {
      const segment = createSectionFromHash(addressOf(location));
      if (segment !== null) setSection(asSection(segment));
    };
    window.addEventListener("hashchange", follow);
    window.addEventListener("popstate", follow);
    return () => {
      window.removeEventListener("hashchange", follow);
      window.removeEventListener("popstate", follow);
    };
  }, []);

  /**
   * Land on the field a diagnostic named, once its section is drawn.
   *
   * A frame late on purpose: a table only draws its fields after its own
   * disclosure has opened, which is a render this one has to come after.
   */
  useEffect(() => {
    if (!wanted) return;
    const timer = setTimeout(() => {
      focusField(wanted);
      setWanted(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [wanted]);

  const result = useMemo(() => (draft ? parsePack(draft) : null), [draft]);
  const diagnostics: Diagnostic[] = result?.diagnostics ?? [];
  const errors = diagnostics.filter((d) => d.level === "error");
  const warnings = diagnostics.filter((d) => d.level === "warning");
  const counts = useMemo(() => countBySection(diagnostics, { droppedSignature }), [diagnostics, droppedSignature]);

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
  const label = SECTIONS.find((s) => s.id === section)?.label ?? "Overview";

  return (
    <main className="main design">
      {dialog}
      <PageHeader
        className="designHeader"
        title={label}
        lead={
          <>
            {str(draft.title) || "Untitled"} · {str(draft.id)}{" "}
            {isPlaceholderId(draft.id) && (
              <>
                <Badge tone="warn">Placeholder</Badge>{" "}
              </>
            )}
            · v{str(draft.version)}{" "}
            {/* The chips are the way into Test: a count nobody can act on
                where it stands is a count that gets read and left. */}
            <button type="button" className={`chip ${errors.length === 0 ? "ok" : "warn"} chipLink`} onClick={() => show("test")}>
              {errors.length === 0 ? "loads" : `${errors.length} ${errors.length === 1 ? "error" : "errors"}`}
            </button>
            {warnings.length > 0 && (
              <button type="button" className="chip chipLink" onClick={() => show("test")}>
                {warnings.length} to look at
              </button>
            )}
          </>
        }
        secondary={
          <>
            <span className={`saveState ${saving}`}>
              {saving === "saved" ? "Saved" : saving === "saving" ? "Saving…" : "Could not save"}
            </span>
            {saving === "failed" && (
              <Button size="compact" onClick={() => unsaved.current && store(unsaved.current)}>
                Try again
              </Button>
            )}
            <Menu label="Draft">
              {(close) => (
                <>
                  <MenuItem
                    onSelect={() => {
                      close();
                      void ask({
                        ask: "Start again from a blank pack?",
                        detail: "The draft you have open is replaced.",
                        confirm: "Start again",
                        destructive: true,
                      }).then((yes) => yes && replace(blankPack()));
                    }}
                  >
                    New pack
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      close();
                      file.current?.click();
                    }}
                  >
                    Open a file…
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      close();
                      setStarting((s) => !s);
                    }}
                  >
                    Start from a pack…
                  </MenuItem>
                </>
              )}
            </Menu>
          </>
        }
        primary={
          onTest && (
            <Button
              disabled={!result?.ok || errors.length > 0}
              onClick={() => result?.ok && onTest(result.pack)}
              title={
                errors.length > 0
                  ? "Fix the problems first; a pack with errors cannot be played"
                  : "Play this draft in a run that is not saved"
              }
            >
              Try it
            </Button>
          )
        }
      />

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

      <nav className="designNav" aria-label="Sections">
        {SECTIONS.map((s) => {
          const count = counts[s.id];
          const shown = count.errors > 0 ? count.errors : count.warnings;
          return (
            <button
              key={s.id}
              type="button"
              className="designNavItem"
              aria-current={s.id === section ? "page" : undefined}
              onClick={() => show(s.id)}
            >
              {s.label}
              {shown > 0 && (
                <Badge
                  tone={count.errors > 0 ? "warn" : "neutral"}
                  title={count.errors > 0 ? `${count.errors} ${count.errors === 1 ? "error" : "errors"}` : `${count.warnings} to look at`}
                >
                  <SeverityGlyph level={count.errors > 0 ? "error" : "warning"} />
                  <span className="num">{shown}</span>
                  <span className="visuallyHidden">{count.errors > 0 ? (count.errors === 1 ? " error" : " errors") : " to look at"}</span>
                </Badge>
              )}
            </button>
          );
        })}
      </nav>

      {problem && <div className="notice">{problem}</div>}

      {starting && (
        <StartFrom
          onPick={(doc) => {
            void askToReplace().then((yes) => {
              if (!yes) return;
              replace(doc as Draft);
              setStarting(false);
            });
          }}
          onClose={() => setStarting(false)}
        />
      )}

      <div className="designBody">
        {section === "overview" && <Overview {...props} focus={wanted} />}
        {section === "tables" && <TablesSection {...props} focus={wanted} />}
        {section === "flow" && <FlowSection {...props} />}
        {section === "modes" && <ModesSection {...props} />}
        {section === "test" && (
          <TestSection
            result={result}
            onGo={(to, path) => {
              show(to);
              setWanted(path);
            }}
          />
        )}
        {section === "publish" && (
          <PublishSection
            {...props}
            pack={result?.ok ? result.pack : null}
            loads={errors.length === 0}
            droppedSignature={droppedSignature}
            onEditIdentity={() => {
              show("overview");
              setWanted("id");
            }}
          />
        )}
      </div>
    </main>
  );
}
