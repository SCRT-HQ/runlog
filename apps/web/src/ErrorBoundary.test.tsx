import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary.tsx";

describe("the error boundary", () => {
  it("renders its children while nothing throws", () => {
    const html = renderToStaticMarkup(
      <ErrorBoundary>
        <p>all is well</p>
      </ErrorBoundary>,
    );
    expect(html).toContain("all is well");
    expect(html).not.toContain("Something broke");
  });

  it("says what broke, offers a reload, and names the build", () => {
    const error = new Error("the dice fell off the table");
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error, copied: false });
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = { error, copied: false };
    const html = renderToStaticMarkup(boundary.render());
    expect(html).toContain("Something broke on this page");
    expect(html).toContain("Error: the dice fell off the table");
    expect(html).toContain("Reload");
    expect(html).toContain("Runlog test");
  });
});
