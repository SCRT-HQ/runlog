import { useState } from "react";
import { BUILTIN_PRESETS, getBuiltinColorBase, type BuiltinColorBaseId } from "@runlog/themes";
import { useConfirm } from "../ui/useConfirm.tsx";
import type { AppliedThemeSourceV1, SavedThemeRow, StoredThemeDraft } from "./themeStorage.ts";

export interface ThemeLibraryActions {
  create(base: BuiltinColorBaseId): void;
  editBuiltin(base: BuiltinColorBaseId): void;
  applyBuiltin(base: BuiltinColorBaseId): Promise<void>;
  editSaved(row: SavedThemeRow): void;
  duplicate(row: SavedThemeRow): void;
  rename(row: SavedThemeRow, name: string): Promise<boolean>;
  delete(row: SavedThemeRow): Promise<boolean>;
  applySaved(row: SavedThemeRow): Promise<void>;
  importText(text: string): Promise<boolean>;
  exportSaved(row: SavedThemeRow): void;
  recover(draft: StoredThemeDraft): void;
}

export interface ThemeLibraryProps {
  readonly library: readonly SavedThemeRow[];
  readonly drafts: readonly StoredThemeDraft[];
  readonly appliedSource: AppliedThemeSourceV1 | null;
  readonly appliedBuiltinId?: BuiltinColorBaseId | null;
  readonly retainedAppearance?: boolean;
  readonly actions: ThemeLibraryActions;
}

const MAX_IMPORT_BYTES = 65_536;

function schemeLabel(scheme: "light" | "dark"): string {
  return scheme === "light" ? "Light" : "Dark";
}

/** The local theme catalog. Persistence remains in the provider-owning parent. */
export function ThemeLibrary({
  library,
  drafts,
  appliedSource,
  appliedBuiltinId = null,
  retainedAppearance = false,
  actions,
}: ThemeLibraryProps) {
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState<SavedThemeRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const perform = async (key: string, operation: () => Promise<void>) => {
    setBusy(key);
    setProblem(null);
    try {
      await operation();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The theme operation failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="themeLibrary" aria-labelledby="themeLibraryTitle">
      <div className="themeSectionHead">
        <div>
          <h2 id="themeLibraryTitle">Your themes</h2>
          <p className="muted">Built-in bases and themes saved only on this device.</p>
        </div>
        <div className="themeLibraryTools">
          <button type="button" className="primary" onClick={() => actions.create("daylight")}>
            Create theme
          </button>
          <label className="buttonLike ghost">
            Import theme JSON
            <input
              className="visuallyHidden"
              type="file"
              accept="application/json,.json"
              aria-label="Import theme JSON"
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                input.value = "";
                if (!file) return;
                if (file.size > MAX_IMPORT_BYTES) {
                  setProblem("Theme JSON must be no larger than 65,536 UTF-8 bytes.");
                  return;
                }
                void perform("import", async () => {
                  const text = await file.text();
                  if (!(await actions.importText(text))) setProblem("The theme could not be imported. You can still keep the source file.");
                });
              }}
            />
          </label>
        </div>
      </div>

      {retainedAppearance && (
        <p className="notice">The current appearance is retained even though its saved source is not in this library.</p>
      )}
      {problem && (
        <p role="alert" className="dangerText">
          {problem}
        </p>
      )}

      {drafts.length > 0 && (
        <section className="themeDraftRecovery" aria-labelledby="themeDraftRecoveryTitle">
          <h3 id="themeDraftRecoveryTitle">Draft recovery</h3>
          <ul>
            {drafts.map((stored) => (
              <li key={stored.id}>
                <span>{stored.draft.rawName || stored.draft.record.name}</span>
                <button type="button" className="ghost" onClick={() => actions.recover(stored)}>
                  Restore draft {stored.draft.rawName || stored.draft.record.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h3>Built-in bases</h3>
      <div className="themeCardGrid">
        {BUILTIN_PRESETS.map((preset) => {
          const scheme = getBuiltinColorBase(preset.id)?.colorScheme ?? "dark";
          return (
            <article className="themeCard" data-testid="builtin-theme" key={preset.id}>
              <div>
                <h4>{preset.label}</h4>
                <p className="muted small">
                  {schemeLabel(scheme)}
                  {appliedBuiltinId === preset.id ? " · Applied" : ""}
                </p>
              </div>
              <div className="themeCardActions">
                <button
                  type="button"
                  className="ghost"
                  disabled={busy !== null}
                  onClick={() => void perform(`apply:${preset.id}`, () => actions.applyBuiltin(preset.id))}
                >
                  Use {preset.label}
                </button>
                <button type="button" className="ghost" onClick={() => actions.editBuiltin(preset.id)}>
                  Edit a copy of {preset.label}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <h3>Saved themes</h3>
      {library.length === 0 ? (
        <p className="muted">No custom themes saved yet.</p>
      ) : (
        <div className="themeCardGrid">
          {library.map((row) => {
            const applied = appliedSource?.id === row.id && appliedSource.localRevision === row.localRevision;
            return (
              <article className="themeCard" key={row.id}>
                <div>
                  <h4>{row.record.name}</h4>
                  <p className="muted small">
                    {schemeLabel(row.record.base.colorScheme)} · {applied ? "Applied · " : ""}Saved on this device
                  </p>
                </div>
                {renaming?.id === row.id ? (
                  <div className="themeRename">
                    <label>
                      <span>New name for {row.record.name}</span>
                      <input className="textInput" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
                    </label>
                    <button
                      type="button"
                      className="primary"
                      onClick={() =>
                        void perform(`rename:${row.id}`, async () => {
                          if (await actions.rename(row, renameValue)) setRenaming(null);
                          else setProblem("The theme name could not be saved.");
                        })
                      }
                    >
                      Save name
                    </button>
                    <button type="button" className="ghost" onClick={() => setRenaming(null)}>
                      Cancel rename
                    </button>
                  </div>
                ) : (
                  <div className="themeCardActions">
                    <button type="button" className="primary" onClick={() => actions.editSaved(row)}>
                      Edit {row.record.name}
                    </button>
                    <button type="button" className="ghost" onClick={() => void perform(`apply:${row.id}`, () => actions.applySaved(row))}>
                      Apply {row.record.name}
                    </button>
                    <button type="button" className="ghost" onClick={() => actions.duplicate(row)}>
                      Duplicate {row.record.name}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setRenaming(row);
                        setRenameValue(row.record.name);
                      }}
                    >
                      Rename {row.record.name}
                    </button>
                    <button type="button" className="ghost" onClick={() => actions.exportSaved(row)}>
                      Download {row.record.name} JSON
                    </button>
                    <button
                      type="button"
                      className="ghost danger"
                      onClick={() => {
                        void (async () => {
                          const accepted = await confirm.ask({
                            ask: `Delete ${row.record.name}?`,
                            detail: "The applied appearance stays in place, but this saved source will be removed.",
                            confirm: "Delete",
                            destructive: true,
                          });
                          if (!accepted) return;
                          await perform(`delete:${row.id}`, async () => {
                            if (!(await actions.delete(row))) setProblem(`${row.record.name} could not be deleted.`);
                          });
                        })();
                      }}
                    >
                      Delete {row.record.name}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {confirm.dialog}
    </section>
  );
}
