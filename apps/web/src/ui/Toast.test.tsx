// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { useToast } from "./Toast.tsx";

/**
 * A note that says something happened, and then is gone.
 *
 * Nothing here asks a question, so there is no answer to check -- only
 * that the text shows up where it is read out, `role="status"`, and that
 * it does not linger once whatever it was reporting is old news.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Probe() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.show("Stream Deck on Thursday")}>go</button>
      {toast.node}
    </>
  );
}

describe("a note that goes away", () => {
  it("shows a note and takes it away again", async () => {
    vi.useFakeTimers();
    render(<Probe />);
    await act(async () => void screen.getByText("go").click());
    expect(screen.getByRole("status").textContent).toBe("Stream Deck on Thursday");
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("restarts the clock when the same words are shown again", async () => {
    vi.useFakeTimers();
    render(<Probe />);
    await act(async () => void screen.getByText("go").click());
    await act(() => vi.advanceTimersByTimeAsync(4000));
    // Not yet five seconds since the first show.
    expect(screen.getByRole("status")).toBeTruthy();
    await act(async () => void screen.getByText("go").click());
    await act(() => vi.advanceTimersByTimeAsync(4000));
    // Eight seconds since the first show, but only four since the second.
    expect(screen.getByRole("status")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
