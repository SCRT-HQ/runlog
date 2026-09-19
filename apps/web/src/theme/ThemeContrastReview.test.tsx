// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshotForBuiltin } from "./appearance.ts";
import { ThemeContrastReportView, useThemeContrastReview } from "./ThemeContrastReview.tsx";
import type { ContrastReport } from "./contrastWarnings.ts";
import type { HexColor } from "@runlog/themes";

const sampling = vi.hoisted(() => ({ disposed: 0, throw: false }));
vi.mock("./browserColorSampler.ts", () => ({
  createBrowserColorSampler: (snapshot: { colorScheme: string }) => ({
    snapshotKey: `snapshot:${snapshot.colorScheme}`,
    sample: () => null,
    dispose: () => {
      sampling.disposed += 1;
    },
  }),
}));
vi.mock("./contrastWarnings.ts", async (original) => {
  const real = await original<typeof import("./contrastWarnings.ts")>();
  return {
    ...real,
    sampleContrastPairs: (snapshot: { colorScheme: string }, options: { widgetPreviewBackdrop: string | null }) => {
      if (sampling.throw) throw new Error("sampling failed");
      const suffix = `${snapshot.colorScheme}:${options.widgetPreviewBackdrop ?? "unknown"}`;
      return {
        snapshotKey: `snapshot:${snapshot.colorScheme}`,
        acknowledgementKey: `ack:${suffix}`,
        summary: "Contrast warnings",
        failures: [
          {
            id: "app.text.primary.page",
            contexts: ["App page"],
            kind: "text",
            foregroundRoles: ["text.primary"],
            backgroundRoles: ["surface.page"],
            minimum: 4.5,
            status: "fail",
            ratio: 2.25,
            foreground: "#777777" as HexColor,
            background: "#ffffff" as HexColor,
            suggestionRole: "text.primary",
            suggestion: "Darken primary text.",
          },
        ],
        pairs: [
          {
            id: "app.text.primary.page",
            contexts: ["App page"],
            kind: "text",
            foregroundRoles: ["text.primary"],
            backgroundRoles: ["surface.page"],
            minimum: 4.5,
            status: "fail",
            ratio: 2.25,
            foreground: "#777777" as HexColor,
            background: "#ffffff" as HexColor,
            suggestionRole: "text.primary",
            suggestion: "Darken primary text.",
          },
          {
            id: "widget.text.primary.none",
            contexts: ["Widget none"],
            kind: "text",
            foregroundRoles: ["widget.text"],
            backgroundRoles: [],
            minimum: 4.5,
            status: "unverified",
            ratio: null,
            foreground: null,
            background: null,
            suggestionRole: "widget.text",
            suggestion: "Choose a known preview backdrop.",
          },
        ],
        notices: ["External background not verified"],
      } satisfies ContrastReport;
    },
  };
});

const light = snapshotForBuiltin("daylight");
const dark = snapshotForBuiltin("lights-down");

function Harness({ scope = "anon:themes" }: { scope?: string }) {
  const review = useThemeContrastReview(scope);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const ask = (snapshot = light, backdrop: HexColor | null = "#ffffff" as HexColor) => {
    void review.review(snapshot, backdrop).then((answer) => setAnswers((before) => [...before, answer]));
  };
  return (
    <>
      <button onClick={() => ask()}>Review light</button>
      <button onClick={() => ask(dark, "#111111" as HexColor)}>Review dark</button>
      <button onClick={() => review.analyze(light, null)}>Analyze unknown</button>
      <output aria-label="Answers">{answers.join(",")}</output>
      <ThemeContrastReportView report={review.report} />
      {review.dialog}
    </>
  );
}

afterEach(() => {
  cleanup();
  sampling.disposed = 0;
  sampling.throw = false;
});

describe("theme contrast review", () => {
  it("keeps warning detail and unavailable external-background notices visible", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze unknown" }));

    expect(screen.getByText("App page").parentElement?.textContent).toContain("2.25:1");
    expect(screen.getByText("App page").parentElement?.textContent).toContain("Target 4.5:1");
    expect(screen.getByText("Darken primary text.")).toBeTruthy();
    expect(screen.getByText("Widget none").parentElement?.textContent).toContain("Unavailable");
    expect(screen.getByText("External background not verified")).toBeTruthy();
    expect(sampling.disposed).toBe(1);
  });

  it("binds acknowledgement to the exact report key and asks again after appearance or backdrop changes", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Review light" }));
    expect(screen.getByRole("dialog", { name: "Review contrast warnings" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Acknowledge and continue" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand these contrast warnings" }));
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge and continue" }));
    expect((await screen.findByRole("status", { name: "Answers" })).textContent).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Review light" }));
    expect(screen.queryByRole("dialog", { name: "Review contrast warnings" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("status", { name: "Answers" }).textContent).toBe("true,true"));

    fireEvent.click(screen.getByRole("button", { name: "Review dark" }));
    expect(screen.getByRole("dialog", { name: "Review contrast warnings" })).toBeTruthy();
  });

  it("rejects superseded, scope-changed and unmounted reviews, and ignores late old answers", async () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Review light" }));
    fireEvent.click(screen.getByRole("button", { name: "Review dark" }));
    expect((await screen.findByRole("status", { name: "Answers" })).textContent).toBe("false");

    view.rerender(<Harness scope="account:user-b:themes" />);
    await waitFor(() => expect(screen.getByRole("status", { name: "Answers" }).textContent).toBe("false,false"));

    fireEvent.click(screen.getByRole("button", { name: "Review light" }));
    await act(async () => view.unmount());
  });

  it("always disposes its sampler when analysis throws", async () => {
    sampling.throw = true;
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Review light" }));
    expect((await screen.findByRole("status", { name: "Answers" })).textContent).toBe("false");
    expect(sampling.disposed).toBe(1);
  });
});
