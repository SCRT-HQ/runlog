// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { useConfirm, type Question } from "./useConfirm.tsx";

/**
 * Asking before something irreversible, in the app's own dialog.
 *
 * `window.confirm` drew this until now, and what it gave for free is
 * exactly what these tests are about: Escape cancels, focus lands on the
 * answer rather than on the page behind, and the promise resolves once,
 * with the right answer, whichever way the question was closed.
 *
 * A dialog that only *looks* right and answers `undefined` would leave a
 * run undiscarded and say nothing, which is worse than the gray box.
 */

function Harness({ question }: { question: Question | string }) {
  const { dialog, ask } = useConfirm();
  return (
    <div>
      <button id="opener" onClick={() => void ask(question).then((yes) => ((window as unknown as { answered: unknown }).answered = yes))}>
        Open
      </button>
      {dialog}
    </div>
  );
}

const answered = () => (window as unknown as { answered: unknown }).answered;
const open = async (question: Question | string = "Discard this trial?") => {
  (window as unknown as { answered: unknown }).answered = "not yet";
  render(<Harness question={question} />);
  // Focus first, then click: a real press does both, and jsdom's click()
  // does not move focus on its own.
  const opener = screen.getByText("Open");
  opener.focus();
  await act(async () => void opener.click());
};

afterEach(() => {
  cleanup();
  (window as unknown as { answered: unknown }).answered = undefined;
});

describe("asking before something irreversible", () => {
  it("says nothing until it is answered", async () => {
    await open();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(answered()).toBe("not yet");
  });

  it("answers true on the button that does the thing", async () => {
    await open({ ask: "Discard this trial?", confirm: "Discard", destructive: true });
    await act(async () => void screen.getByText("Discard").click());
    expect(answered()).toBe(true);
    // And it goes away, rather than leaving a veil over a done thing.
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("answers false on Cancel", async () => {
    await open();
    await act(async () => void screen.getByText("Cancel").click());
    expect(answered()).toBe(false);
  });

  it("answers false on Escape, which is what the browser's did", async () => {
    await open();
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(answered()).toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("puts focus on the answer, so Enter answers the question", async () => {
    // Without this, Enter goes to whatever was focused behind the veil,
    // which is the button that opened the dialog.
    await open({ ask: "Discard this trial?", confirm: "Discard" });
    expect((document.activeElement as HTMLElement).textContent).toBe("Discard");
  });

  it("gives focus back to whatever asked", async () => {
    await open();
    await act(async () => void screen.getByText("Cancel").click());
    expect((document.activeElement as HTMLElement).id).toBe("opener");
  });

  it("names the action rather than saying OK", async () => {
    await open({ ask: "Discard this trial?", detail: "Its log is deleted.", confirm: "Discard", destructive: true });
    expect(screen.getByText("Discard")).toBeTruthy();
    expect(screen.queryByText("OK")).toBeNull();
    // The consequence is said, which the one-line native box could not do
    // without running the question and the answer together.
    expect(screen.getByText("Its log is deleted.")).toBeTruthy();
  });

  it("is announced as a dialog that wants an answer", async () => {
    await open({ ask: "Discard this trial?", detail: "Its log is deleted." });
    const box = screen.getByRole("alertdialog");
    expect(box.getAttribute("aria-modal")).toBe("true");
    expect(box.getAttribute("aria-labelledby")).toBe("confirmAsk");
    expect(box.getAttribute("aria-describedby")).toBe("confirmDetail");
  });

  it("answers once, however many ways it is closed", async () => {
    const resolved = vi.fn();
    function Once() {
      const { dialog, ask } = useConfirm();
      return (
        <div>
          <button onClick={() => void ask("Sure?").then(resolved)}>Open</button>
          {dialog}
        </div>
      );
    }
    render(<Once />);
    await act(async () => void screen.getByText("Open").click());
    await act(async () => void screen.getByText("Cancel").click());
    // Escape after it has gone must not answer a promise already settled.
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(resolved).toHaveBeenCalledWith(false);
  });
});

describe("a question that destroys something", () => {
  it("puts focus on the safe answer, so a reflex cancels", async () => {
    await open({ ask: "Discard this trial?", confirm: "Discard", destructive: true });
    expect((document.activeElement as HTMLElement).textContent).toBe("Cancel");
  });

  it("does not let a bare Enter answer a dialog that has only just opened", async () => {
    await open({ ask: "Discard this trial?", confirm: "Discard", destructive: true });
    const early = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => void (document.activeElement as HTMLElement).dispatchEvent(early));
    expect(early.defaultPrevented).toBe(true);
    expect(answered()).toBe("not yet");
    // A frame later it is a dialog somebody has seen, and Enter is theirs.
    await act(async () => {
      await new Promise((settle) => requestAnimationFrame(() => settle(undefined)));
    });
    const later = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => void (document.activeElement as HTMLElement).dispatchEvent(later));
    expect(later.defaultPrevented).toBe(false);
  });

  it("keeps the page behind it out of the keyboard's reach", async () => {
    await open({ ask: "Discard this trial?", confirm: "Discard", destructive: true });
    expect(screen.getByText("Open").closest("[inert]")).not.toBeNull();
    await act(async () => void screen.getByText("Cancel").click());
    expect(screen.getByText("Open").closest("[inert]")).toBeNull();
  });
});
