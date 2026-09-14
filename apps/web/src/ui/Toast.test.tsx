// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { render, screen } from "@testing-library/react";
import { useToast } from "./Toast.tsx";

/**
 * A note that says something happened, and then is gone.
 *
 * Nothing here asks a question, so there is no answer to check -- only
 * that the text shows up where it is read out, `role="status"`, and that
 * it does not linger once whatever it was reporting is old news.
 */

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
    vi.useRealTimers();
  });
});
