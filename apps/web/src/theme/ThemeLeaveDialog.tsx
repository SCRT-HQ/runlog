import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useFocusTrap } from "../ui/useFocusTrap.ts";

export interface ThemeLeaveActions {
  saveDraft(): Promise<boolean>;
  discard(): Promise<boolean>;
}

interface PendingLeave {
  readonly scopeKey: string;
  readonly generation: number;
  readonly actions: ThemeLeaveActions;
  readonly resolve: (accepted: boolean) => void;
}

export interface ThemeLeaveDialogController {
  request(actions: ThemeLeaveActions): Promise<boolean>;
  readonly dialog: ReactNode;
}

/** Owns the async three-choice transaction used by routed and browser-shell navigation. */
export function useThemeLeaveDialog(scopeKey: string): ThemeLeaveDialogController {
  const scopeRef = useRef(scopeKey);
  const effectScopeRef = useRef(scopeKey);
  const generationRef = useRef(0);
  const pendingRef = useRef<PendingLeave | null>(null);
  const [pending, setPending] = useState<PendingLeave | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);

  if (scopeRef.current !== scopeKey) {
    scopeRef.current = scopeKey;
    generationRef.current += 1;
  }

  const cancel = useCallback((updateState = true) => {
    generationRef.current += 1;
    const current = pendingRef.current;
    pendingRef.current = null;
    current?.resolve(false);
    if (updateState) {
      setPending(null);
      setBusy(false);
      setProblem(null);
    }
  }, []);

  useEffect(() => {
    if (effectScopeRef.current === scopeKey) return;
    effectScopeRef.current = scopeKey;
    cancel();
  }, [cancel, scopeKey]);

  useEffect(
    () => () => {
      cancel(false);
    },
    [cancel],
  );

  const request = useCallback(
    (actions: ThemeLeaveActions): Promise<boolean> => {
      cancel();
      const generation = ++generationRef.current;
      setBusy(false);
      setProblem(null);
      return new Promise<boolean>((resolve) => {
        const value = { scopeKey, generation, actions, resolve };
        pendingRef.current = value;
        setPending(value);
      });
    },
    [cancel, scopeKey],
  );

  const visible = pending?.scopeKey === scopeKey ? pending : null;
  const keepEditing = useCallback(() => cancel(), [cancel]);
  useFocusTrap(panel, visible !== null, keepEditing, keepButton);

  const complete = useCallback(async (kind: "saveDraft" | "discard") => {
    const current = pendingRef.current;
    if (current === null || current.scopeKey !== scopeRef.current) return;
    setBusy(true);
    setProblem(null);
    let accepted = false;
    try {
      accepted = await current.actions[kind]();
    } catch (error) {
      if (pendingRef.current === current && current.scopeKey === scopeRef.current) {
        setProblem(error instanceof Error ? error.message : "The draft transaction failed.");
      }
    }
    if (pendingRef.current !== current || current.scopeKey !== scopeRef.current || current.generation !== generationRef.current) {
      return;
    }
    setBusy(false);
    if (!accepted) {
      setProblem(
        kind === "saveDraft"
          ? "The draft was not saved. Keep editing or try again."
          : "The draft was not discarded. It is still recoverable.",
      );
      return;
    }
    pendingRef.current = null;
    setPending(null);
    setProblem(null);
    current.resolve(true);
  }, []);

  const dialog =
    visible === null ? null : (
      <div
        className="veil themeStudioControl"
        role="presentation"
        onClick={(event) => event.target === event.currentTarget && keepEditing()}
      >
        <section
          ref={panel}
          className="panel confirmDialog themeLeaveDialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="themeLeaveTitle"
          tabIndex={-1}
        >
          <h2 id="themeLeaveTitle">Leave theme editor?</h2>
          <p>Your current changes have not been finalized as a saved theme.</p>
          {problem && (
            <p className="dangerText" role="alert">
              {problem}
            </p>
          )}
          <div className="padRow confirmActions">
            <button ref={keepButton} type="button" className="ghost" disabled={busy} onClick={keepEditing}>
              Keep editing
            </button>
            <button type="button" className="primary" disabled={busy} onClick={() => void complete("saveDraft")}>
              Save draft and leave
            </button>
            <button type="button" className="ghost danger" disabled={busy} onClick={() => void complete("discard")}>
              Discard and leave
            </button>
          </div>
        </section>
      </div>
    );

  return { request, dialog };
}
