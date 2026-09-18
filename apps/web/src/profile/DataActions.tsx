import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button.tsx";

type ExportState = { kind: "idle" } | { kind: "busy" } | { kind: "done"; bytes: number } | { kind: "failed"; why: string };

export function DataExport({
  disabled,
  onExport,
  onDownload = (url) => location.assign(url),
}: {
  disabled: boolean;
  onExport: () => Promise<{ url: string; bytes: number }>;
  /** A narrow navigation boundary keeps verification synthetic; production uses location.assign. */
  onDownload?: (url: string) => void;
}) {
  const [state, setState] = useState<ExportState>({ kind: "idle" });
  const pending = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = async () => {
    if (disabled || pending.current) return;
    pending.current = true;
    setState({ kind: "busy" });
    let result: { url: string; bytes: number };
    try {
      result = await onExport();
    } catch (error) {
      pending.current = false;
      if (!mounted.current) return;
      setState({ kind: "failed", why: error instanceof Error && error.message ? error.message : "the export could not be made" });
      return;
    }
    pending.current = false;
    if (mounted.current) setState({ kind: "done", bytes: result.bytes });
    onDownload(result.url);
  };

  const status =
    state.kind === "done"
      ? `${Math.max(1, Math.round(state.bytes / 1024))} KB, as JSON. The link works for fifteen minutes.`
      : state.kind === "failed"
        ? state.why
        : "";
  return (
    <div className="padRow dataAction">
      <Button disabled={disabled} loading={state.kind === "busy"} loadingLabel="Gathering…" onClick={() => void start()}>
        Download everything
      </Button>
      <span className="dataActionStatus muted" role="status">
        {status}
      </span>
    </div>
  );
}

export function ServerDelete({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => Promise<void> }) {
  const [state, setState] = useState<"idle" | "arming" | "busy" | "done" | "failed">("idle");
  const pending = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const confirm = async () => {
    if (state !== "arming" || pending.current) return;
    pending.current = true;
    setState("busy");
    try {
      await onConfirm();
      pending.current = false;
      if (mounted.current) setState("done");
    } catch {
      pending.current = false;
      if (mounted.current) setState("failed");
    }
  };

  return (
    <div className="padRow dataAction">
      {state === "done" ? null : state === "arming" ? (
        <>
          <Button variant="danger" onClick={() => void confirm()}>
            Yes, delete everything of mine on the server
          </Button>
          <Button onClick={() => setState("idle")}>Keep it</Button>
        </>
      ) : (
        <Button variant="danger" disabled={disabled} loading={state === "busy"} loadingLabel="Deleting…" onClick={() => setState("arming")}>
          Delete everything of mine on the server
        </Button>
      )}
      <span className={`dataActionStatus ${state === "failed" ? "warnText" : "muted"}`} role="status">
        {state === "done"
          ? "Done. The server holds nothing of yours now."
          : state === "failed"
            ? "That did not go through. Try again in a moment."
            : ""}
      </span>
    </div>
  );
}
