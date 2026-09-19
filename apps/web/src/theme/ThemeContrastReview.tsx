import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { HexColor, PresentationSnapshotV1 } from "@runlog/themes";
import { useFocusTrap } from "../ui/useFocusTrap.ts";
import { createBrowserColorSampler } from "./browserColorSampler.ts";
import { isContrastAcknowledged, sampleContrastPairs, type ContrastReport } from "./contrastWarnings.ts";

function createReport(snapshot: PresentationSnapshotV1, widgetPreviewBackdrop: HexColor | null): ContrastReport {
  const sampler = createBrowserColorSampler(snapshot, document);
  try {
    return sampleContrastPairs(snapshot, { widgetPreviewBackdrop }, sampler);
  } finally {
    sampler.dispose();
  }
}

/** Warning detail shared by the editor, quick picker and acknowledgement dialog. */
export function ThemeContrastReportView({ report }: { readonly report: ContrastReport | null }) {
  if (report === null) return null;
  const noteworthy = report.pairs.filter(({ status }) => status !== "pass" && status !== "conditional-pass");
  return (
    <section className="themeContrastReport" aria-live="polite">
      <h3>{report.summary}</h3>
      {noteworthy.length > 0 && (
        <ul className="themeContrastPairs">
          {noteworthy.map((pair) => (
            <li key={pair.id}>
              <strong>{pair.contexts.join(", ") || pair.id}</strong>
              <code className="small">{pair.id}</code>
              <span className="small">
                {pair.ratio === null ? "Unavailable" : `${pair.ratio.toFixed(2)}:1`} · Target {pair.minimum}:1 · {pair.contexts.join(", ")}
              </span>
              <span className="muted small">{pair.suggestion}</span>
            </li>
          ))}
        </ul>
      )}
      {report.notices.map((notice) => (
        <p className="muted small" key={notice}>
          {notice}
        </p>
      ))}
    </section>
  );
}

interface ScopedReport {
  readonly scopeKey: string | null;
  readonly report: ContrastReport;
}

interface PendingReview extends ScopedReport {
  readonly generation: number;
}

interface PendingAnswer {
  readonly scopeKey: string | null;
  readonly generation: number;
  readonly resolve: (accepted: boolean) => void;
}

export interface ThemeContrastReview {
  readonly report: ContrastReport | null;
  readonly acknowledgementKey: string | null;
  readonly problem: string | null;
  readonly dialog: ReactNode;
  analyze(snapshot: PresentationSnapshotV1, widgetPreviewBackdrop: HexColor | null): ContrastReport | null;
  review(snapshot: PresentationSnapshotV1, widgetPreviewBackdrop: HexColor | null): Promise<boolean>;
}

/** Owns one scope's sampled report and exact-key acknowledgement transaction. */
export function useThemeContrastReview(scopeKey: string | null): ThemeContrastReview {
  const scopeRef = useRef(scopeKey);
  const generationRef = useRef(0);
  const answerRef = useRef<PendingAnswer | null>(null);
  const [shown, setShown] = useState<ScopedReport | null>(null);
  const [pending, setPending] = useState<PendingReview | null>(null);
  const [acknowledgementKey, setAcknowledgementKey] = useState<string | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const acceptButton = useRef<HTMLButtonElement>(null);

  const settle = useCallback((generation: number) => {
    const answer = answerRef.current;
    if (answer === null || answer.generation !== generation || answer.scopeKey !== scopeRef.current) return;
    answerRef.current = null;
    setPending(null);
    setUnderstood(false);
    answer.resolve(false);
  }, []);

  const cancelCurrent = useCallback((updateState = true) => {
    generationRef.current += 1;
    const answer = answerRef.current;
    answerRef.current = null;
    answer?.resolve(false);
    if (updateState) {
      setPending(null);
      setUnderstood(false);
    }
  }, []);

  useEffect(() => {
    if (scopeRef.current === scopeKey) return;
    scopeRef.current = scopeKey;
    cancelCurrent();
    setShown(null);
    setAcknowledgementKey(null);
    setProblem(null);
  }, [cancelCurrent, scopeKey]);

  useEffect(
    () => () => {
      cancelCurrent(false);
    },
    [cancelCurrent],
  );

  const analyze = useCallback(
    (snapshot: PresentationSnapshotV1, widgetPreviewBackdrop: HexColor | null): ContrastReport | null => {
      try {
        const report = createReport(snapshot, widgetPreviewBackdrop);
        setShown({ scopeKey, report });
        setProblem(null);
        if (acknowledgementKey !== null && acknowledgementKey !== report.acknowledgementKey) setAcknowledgementKey(null);
        if (pending !== null && pending.report.acknowledgementKey !== report.acknowledgementKey) cancelCurrent();
        return report;
      } catch (error) {
        setProblem(error instanceof Error ? error.message : "Contrast checks are unavailable");
        cancelCurrent();
        return null;
      }
    },
    [acknowledgementKey, cancelCurrent, pending, scopeKey],
  );

  const review = useCallback(
    (snapshot: PresentationSnapshotV1, widgetPreviewBackdrop: HexColor | null): Promise<boolean> => {
      const report = analyze(snapshot, widgetPreviewBackdrop);
      if (report === null) return Promise.resolve(false);
      if (report.failures.length === 0 || isContrastAcknowledged(report, acknowledgementKey)) return Promise.resolve(true);

      cancelCurrent();
      const generation = ++generationRef.current;
      setPending({ scopeKey, generation, report });
      setUnderstood(false);
      return new Promise<boolean>((resolve) => {
        answerRef.current = { scopeKey, generation, resolve };
      });
    },
    [acknowledgementKey, analyze, cancelCurrent, scopeKey],
  );

  const visiblePending = pending?.scopeKey === scopeKey ? pending : null;
  const close = useCallback(() => {
    if (visiblePending !== null) settle(visiblePending.generation);
  }, [settle, visiblePending]);
  useFocusTrap(panel, visiblePending !== null, close, acceptButton);

  const dialog =
    visiblePending === null ? null : (
      <div className="veil themeStudioControl" role="presentation" onClick={(event) => event.target === event.currentTarget && close()}>
        <section
          ref={panel}
          className="panel confirmDialog themeContrastDialog"
          role="dialog"
          aria-modal="true"
          aria-label="Review contrast warnings"
          tabIndex={-1}
        >
          <h2>Review contrast warnings</h2>
          <ThemeContrastReportView report={visiblePending.report} />
          <label className="checkLine">
            <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
            <span>I understand these contrast warnings</span>
          </label>
          <div className="padRow confirmActions">
            <button
              ref={acceptButton}
              type="button"
              className="primary"
              disabled={!understood}
              onClick={() => {
                setAcknowledgementKey(visiblePending.report.acknowledgementKey);
                const answer = answerRef.current;
                if (answer?.generation !== visiblePending.generation) return;
                answerRef.current = null;
                setPending(null);
                setUnderstood(false);
                answer.resolve(true);
              }}
            >
              Acknowledge and continue
            </button>
            <button type="button" className="ghost" onClick={close}>
              Cancel
            </button>
          </div>
        </section>
      </div>
    );

  return {
    report: shown?.scopeKey === scopeKey ? shown.report : null,
    acknowledgementKey,
    problem,
    dialog,
    analyze,
    review,
  };
}
