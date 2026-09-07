import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The last thing standing when a render throws.
 *
 * React unmounts the whole tree on an uncaught render error, which left a
 * blank page with nothing to do. This catches it and says what happened in
 * plain words, offers a reload, and lets the person copy the error to send
 * along. Nothing is sent anywhere by itself; the app has no telemetry.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; copied: boolean }> {
  override state: { error: Error | null; copied: boolean } = { error: null, copied: false };

  static getDerivedStateFromError(error: Error) {
    return { error, copied: false };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Runlog stopped rendering:", error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const report = [`Runlog ${__RUNLOG_VERSION__}${__RUNLOG_SHA__ ? ` (${__RUNLOG_SHA__})` : ""}`, `${error.name}: ${error.message}`, error.stack ?? ""].join("\n");
    return (
      <main className="main">
        <section className="panel broke">
          <h2>Something broke on this page</h2>
          <p>
            The app stopped drawing. Your packs and runs are safe: they are saved as they happen, and a reload brings them back. If it breaks again
            the same way, copy the error and send it with what you were doing.
          </p>
          <pre className="brokeError">{`${error.name}: ${error.message}`}</pre>
          <div className="padRow">
            <button className="primary" onClick={() => location.reload()}>
              Reload
            </button>
            <button
              className="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(report).then(() => this.setState({ copied: true }));
              }}
            >
              {this.state.copied ? "Copied" : "Copy the error"}
            </button>
            <a className="ghost buttonLink" href="#guide/start">
              Open the docs
            </a>
          </div>
          <p className="muted small">
            Runlog {__RUNLOG_VERSION__}
            {__RUNLOG_SHA__ ? ` · ${__RUNLOG_SHA__}` : ""}
          </p>
        </section>
      </main>
    );
  }
}
