// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThemeLeaveDialog } from "./ThemeLeaveDialog.tsx";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Harness({ scope = "anon:themes", action = async () => true }: { scope?: string; action?: () => Promise<boolean> }) {
  const leave = useThemeLeaveDialog(scope);
  return (
    <>
      <button
        onClick={() =>
          void leave
            .request({ saveDraft: action, discard: action })
            .then((accepted) => document.body.setAttribute("data-answer", String(accepted)))
        }
      >
        Ask to leave
      </button>
      {leave.dialog}
    </>
  );
}

afterEach(() => {
  cleanup();
  document.body.removeAttribute("data-answer");
});

describe("theme leave dialog", () => {
  it("keeps editing on Escape and focuses the safe choice", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Ask to leave" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(document.body.getAttribute("data-answer")).toBe("false"));
  });

  it("only accepts after the selected transaction succeeds and leaves the dialog open on failure", async () => {
    const action = vi.fn(async () => false);
    render(<Harness action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask to leave" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft and leave" }));
    await screen.findByRole("alert");
    expect(document.body.getAttribute("data-answer")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("resolves false on scope change and ignores a late old success", async () => {
    const pending = deferred<boolean>();
    const view = render(<Harness action={() => pending.promise} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask to leave" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard and leave" }));
    view.rerender(<Harness scope="account:next:themes" action={() => pending.promise} />);
    await waitFor(() => expect(document.body.getAttribute("data-answer")).toBe("false"));
    pending.resolve(true);
    await Promise.resolve();
    expect(document.body.getAttribute("data-answer")).toBe("false");
  });

  it("resolves false when unmounted with a pending prompt", async () => {
    let answer: boolean | null = null;
    function PendingHarness() {
      const leave = useThemeLeaveDialog("anon:themes");
      return (
        <>
          <button
            onClick={() =>
              void leave.request({ saveDraft: async () => true, discard: async () => true }).then((value) => {
                answer = value;
              })
            }
          >
            Ask
          </button>
          {leave.dialog}
        </>
      );
    }
    const view = render(<PendingHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    view.unmount();
    await waitFor(() => expect(answer).toBe(false));
  });
});
