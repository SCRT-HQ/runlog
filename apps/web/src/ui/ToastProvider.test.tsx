// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { useToast } from "./Toast.tsx";
import { ToastProvider } from "./ToastProvider.tsx";

/**
 * One slot for the app, not one per page that has news.
 *
 * Before this, the run's view and the people panel each held a slot and
 * both drew at the same place, so whichever spoke second painted over the
 * first. What is checked here is that two callers under one provider make
 * one line, and that a page rendered with no provider above it, which is
 * every test that renders a component on its own, still says its piece.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Caller({ says, label }: { says: string; label: string }) {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.show(says)}>{label}</button>
      {toast.node}
    </>
  );
}

describe("the app's one slot", () => {
  it("draws one line for two callers", async () => {
    render(
      <ToastProvider>
        <Caller says="A deck attached" label="one" />
        <Caller says="A setup was handed out" label="two" />
      </ToastProvider>,
    );
    await act(async () => void screen.getByText("one").click());
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("A deck attached");

    // The second caller says something while the first is still up: one
    // line, saying the newer thing, rather than two stacked on each other.
    await act(async () => void screen.getByText("two").click());
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("A setup was handed out");
  });

  it("takes the line away again", async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Caller says="A deck attached" label="one" />
      </ToastProvider>,
    );
    await act(async () => void screen.getByText("one").click());
    expect(screen.getByRole("status")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leaves a page with no provider above it holding its own slot", async () => {
    render(<Caller says="A deck attached" label="one" />);
    await act(async () => void screen.getByText("one").click());
    expect(screen.getByRole("status").textContent).toBe("A deck attached");
  });
});
