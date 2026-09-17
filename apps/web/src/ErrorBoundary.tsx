import { linkTo } from "./route.ts";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, ButtonLink } from "./ui/Button.tsx";

type CopyState = "idle" | "pending" | "success" | "failure";

/**
 * The last thing standing when a render throws.
 *
 * React unmounts the whole tree on an uncaught render error, which left a
 * blank page with nothing to do. This catches it and says what happened in
 * plain words, offers a reload, and lets the person copy the error to send
 * along. Nothing is sent anywhere by itself; the app has no telemetry.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; copyState: CopyState }> {
  override state: { error: Error | null; copyState: CopyState } = { error: null, copyState: "idle" };

  static getDerivedStateFromError(error: Error) {
    return { error, copyState: "idle" as const };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Runlog stopped rendering:", error, info.componentStack);
  }

  private copy = (report: string) => {
    if (this.state.copyState === "pending") return;
    this.setState({ copyState: "pending" });
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      void Promise.resolve(navigator.clipboard.writeText(report)).then(
        () => this.setState({ copyState: "success" }),
        () => this.setState({ copyState: "failure" }),
      );
    } catch {
      this.setState({ copyState: "failure" });
    }
  };

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const report = [
      `Runlog ${__RUNLOG_VERSION__}${__RUNLOG_SHA__ ? ` (${__RUNLOG_SHA__})` : ""}`,
      `${error.name}: ${error.message}`,
      error.stack ?? "",
    ].join("\n");
    const copyFeedback =
      this.state.copyState === "success" ? "Copied" : this.state.copyState === "failure" ? "Could not copy the error. Try again." : null;
    return (
      <main className="main">
        <section className="panel broke" aria-labelledby="brokeTitle">
          <h2 id="brokeTitle">Something broke on this page</h2>
          <p>
            The app stopped drawing. Your packs and runs are safe: they are saved as they happen, and a reload brings them back. If it
            breaks again the same way, copy the error and send it with what you were doing.
          </p>
          <pre className="brokeError">{`${error.name}: ${error.message}`}</pre>
          <div className="padRow">
            <Button variant="primary" onClick={() => location.reload()}>
              Reload
            </Button>
            <Button loading={this.state.copyState === "pending"} loadingLabel="Copying…" onClick={() => this.copy(report)}>
              Copy the error
            </Button>
            <ButtonLink href={linkTo("#guide/start")}>Open the docs</ButtonLink>
          </div>
          {copyFeedback && (
            <p className="brokeCopyStatus" role="status">
              {copyFeedback}
            </p>
          )}
          <p className="muted small">
            Runlog {__RUNLOG_VERSION__}
            {__RUNLOG_SHA__ ? ` · ${__RUNLOG_SHA__}` : ""}
          </p>
        </section>
      </main>
    );
  }
}
