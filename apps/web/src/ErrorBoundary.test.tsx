// @vitest-environment jsdom
import { act } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function clipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

function broken(message = "the dice fell off the table") {
  const error = new Error(message);
  error.stack = "Error: the dice fell off the table\n    at DrawThePage";
  const Throws = () => {
    throw error;
  };
  render(
    <ErrorBoundary>
      <Throws />
    </ErrorBoundary>,
  );
  return error;
}

describe("the error boundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    else delete (navigator as { clipboard?: Clipboard }).clipboard;
  });

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
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error, copyState: "idle" });
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = { error, copyState: "idle" };
    const html = renderToStaticMarkup(boundary.render());
    expect(html).toContain("Something broke on this page");
    expect(html).toContain("Error: the dice fell off the table");
    expect(html).toContain("Reload");
    expect(html).toContain("Runlog test");
    expect(html).toContain('href="#guide/start"');
    expect(html).not.toContain("full report below");
  });

  it("does not copy on render, then announces a successful full-report copy", async () => {
    const writeText = vi.fn(async () => {});
    clipboard(writeText);
    broken();
    expect(writeText).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Copy the error" }));
    await screen.findByRole("status");

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(
      "Runlog test\nError: the dice fell off the table\nError: the dice fell off the table\n    at DrawThePage",
    );
    expect(screen.getByRole("status").textContent).toBe("Copied");
    expect(screen.getByRole("button", { name: "Copy the error" }).hasAttribute("disabled")).toBe(false);
  });

  it("marks a copy pending and prevents duplicate writes", async () => {
    let finish!: () => void;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    clipboard(writeText);
    broken();

    fireEvent.click(screen.getByRole("button", { name: "Copy the error" }));
    const pending = screen.getByRole("button", { name: "Copying…" });
    expect(pending.hasAttribute("disabled")).toBe(true);
    expect(pending.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(pending);
    expect(writeText).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(screen.getByRole("status").textContent).toBe("Copied");
  });

  it("announces a rejected copy and allows a successful retry", async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error("permission denied")).mockResolvedValueOnce(undefined);
    clipboard(writeText);
    broken();

    fireEvent.click(screen.getByRole("button", { name: "Copy the error" }));
    expect((await screen.findByRole("status")).textContent).toBe("Could not copy the error. Try again.");
    const retry = screen.getByRole("button", { name: "Copy the error" });
    expect(retry.hasAttribute("disabled")).toBe(false);

    fireEvent.click(retry);
    await act(async () => await Promise.resolve());
    expect(screen.getByRole("status").textContent).toBe("Copied");
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it("handles an unavailable clipboard and leaves the action retryable", async () => {
    clipboard();
    broken();

    fireEvent.click(screen.getByRole("button", { name: "Copy the error" }));
    expect((await screen.findByRole("status")).textContent).toBe("Could not copy the error. Try again.");
    expect(screen.getByRole("button", { name: "Copy the error" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("link", { name: "Open the docs" }).getAttribute("href")).toBe("#guide/start");
    expect(screen.getByText("Error: the dice fell off the table")).toBeTruthy();
  });

  it("handles a synchronously throwing clipboard and leaves the action retryable", async () => {
    clipboard(() => {
      throw new Error("blocked before promise");
    });
    broken();

    fireEvent.click(screen.getByRole("button", { name: "Copy the error" }));
    expect((await screen.findByRole("status")).textContent).toBe("Could not copy the error. Try again.");
    expect(screen.getByRole("button", { name: "Copy the error" }).hasAttribute("disabled")).toBe(false);
  });
});
