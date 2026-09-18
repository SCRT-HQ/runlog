// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredLicense } from "../storage/db.ts";
import { LicenseRow } from "./LicenseRow.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const license = (key = "ABCDEF-12345"): StoredLicense => ({
  packId: "pack-one",
  key,
  ref: "order-42",
  title: "Pack One",
  updatedAt: "2026-09-16T00:00:00.000Z",
});

function clipboard(writeText?: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

beforeEach(() => clipboard());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("license key disclosure and copying", () => {
  it("does nothing on render and keeps the exact key masked until Show", () => {
    const writeText = vi.fn(async () => {});
    clipboard(writeText);
    render(<LicenseRow license={license()} title="A very long pack title" onForget={vi.fn(async () => {})} />);

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByText("••••••-12345")).toBeTruthy();
    expect(screen.queryByText("ABCDEF-12345")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText("ABCDEF-12345")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("ABCDEF-12345")).toBeNull();
  });

  it.each([
    ["a missing clipboard", undefined],
    ["a rejected clipboard", () => Promise.reject(new Error("denied"))],
    [
      "a synchronously throwing clipboard",
      () => {
        throw new Error("blocked");
      },
    ],
  ] as const)("reports %s truthfully and retries the exact synthetic key", async (_case, failedWrite) => {
    if (failedWrite) clipboard(failedWrite);
    const view = render(<LicenseRow license={license()} title="Pack One" onForget={vi.fn(async () => {})} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await act(async () => void (await Promise.resolve()));
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/could not copy|clipboard is unavailable/i);
    expect(status.textContent).not.toContain("ABCDEF-12345");
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();

    const retry = vi.fn(async () => {});
    clipboard(retry);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await act(async () => void (await Promise.resolve()));
    expect(retry).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledWith("ABCDEF-12345");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(status.textContent).toBe("License key copied.");
    expect(view.container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("keeps a deferred copy single-flight across ordinary rerenders", async () => {
    const pending = deferred<void>();
    const writeText = vi.fn(() => pending.promise);
    clipboard(writeText);
    const onForget = vi.fn(async () => {});
    const view = render(<LicenseRow license={license()} title="Pack One" onForget={onForget} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    const busy = screen.getByRole("button", { name: "Copying…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(busy);
    view.rerender(<LicenseRow license={license()} title="Pack One, rerendered" onForget={onForget} />);
    expect(screen.getByRole("button", { name: "Copying…" })).toBeTruthy();
    expect(writeText).toHaveBeenCalledOnce();

    await act(async () => pending.resolve());
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("License key copied.");
  });

  it("does not attach an obsolete copy result to a replacement license", async () => {
    const pending = deferred<void>();
    clipboard(vi.fn(() => pending.promise));
    const view = render(<LicenseRow license={license()} title="Pack One" onForget={vi.fn(async () => {})} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    view.rerender(<LicenseRow license={license("SECOND-67890")} title="Pack Two" onForget={vi.fn(async () => {})} />);
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("");
    await act(async () => pending.resolve());
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("masks a replacement license in the committed render even when the old key was shown", () => {
    const view = render(<LicenseRow license={license()} title="Pack One" onForget={vi.fn(async () => {})} />);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText("ABCDEF-12345")).toBeTruthy();

    view.rerender(<LicenseRow license={license("SECOND-67890")} title="Pack Two" onForget={vi.fn(async () => {})} />);
    expect(screen.queryByText("SECOND-67890")).toBeNull();
    expect(screen.getByText("••••••-67890")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show" })).toBeTruthy();
  });

  it("does not revive an old copy result after an A-to-B-to-A identity reuse", async () => {
    const pending = deferred<void>();
    clipboard(vi.fn(() => pending.promise));
    const first = license();
    const replacement = license("SECOND-67890");
    const view = render(<LicenseRow license={first} title="Pack One" onForget={vi.fn(async () => {})} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    view.rerender(<LicenseRow license={replacement} title="Pack Two" onForget={vi.fn(async () => {})} />);
    view.rerender(<LicenseRow license={first} title="Pack One again" onForget={vi.fn(async () => {})} />);
    await act(async () => pending.resolve());
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("lets copy and forget settle independently when both were explicitly started", async () => {
    const copied = deferred<void>();
    const forgotten = deferred<void>();
    clipboard(vi.fn(() => copied.promise));
    const onForget = vi.fn(() => forgotten.promise);
    render(<LicenseRow license={license()} title="Pack One" onForget={onForget} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    fireEvent.click(screen.getByRole("button", { name: "Forget it" }));
    await act(async () => copied.resolve());
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Forgetting…" })).toBeTruthy();

    await act(async () => forgotten.resolve());
    expect(screen.getByRole("button", { name: "Forgotten" })).toBeTruthy();
    expect(onForget).toHaveBeenCalledOnce();
  });
});

describe("forgetting a license", () => {
  it("requires two presses, lets Keep disarm, and guards the pending callback", async () => {
    const pending = deferred<void>();
    const onForget = vi.fn(() => pending.promise);
    render(<LicenseRow license={license()} title="Pack One" onForget={onForget} />);

    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    expect(onForget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.getByRole("button", { name: "Forget" })).toBeTruthy();
    expect(onForget).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    fireEvent.click(screen.getByRole("button", { name: "Forget it" }));
    const busy = screen.getByRole("button", { name: "Forgetting…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
    fireEvent.click(busy);
    expect(onForget).toHaveBeenCalledOnce();

    await act(async () => pending.resolve());
    expect(onForget).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toBe("License key forgotten.");
  });

  it("announces rejection and restores a recoverable two-press path", async () => {
    const onForget = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    render(<LicenseRow license={license()} title="Pack One" onForget={onForget} />);

    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    fireEvent.click(screen.getByRole("button", { name: "Forget it" }));
    await act(async () => void (await Promise.resolve()));
    expect(screen.getByRole("status").textContent).toBe("The license key was not forgotten. Press Forget to try again.");
    expect(screen.getByRole("button", { name: "Forget" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    expect(onForget).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Forget it" }));
    await act(async () => void (await Promise.resolve()));
    expect(onForget).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status").textContent).toBe("License key forgotten.");
  });

  it("does not attach an obsolete forget failure to a replacement license", async () => {
    const pending = deferred<void>();
    const view = render(<LicenseRow license={license()} title="Pack One" onForget={() => pending.promise} />);
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    fireEvent.click(screen.getByRole("button", { name: "Forget it" }));

    view.rerender(<LicenseRow license={license("SECOND-67890")} title="Pack Two" onForget={vi.fn(async () => {})} />);
    await act(async () => pending.reject(new Error("old failure")));
    expect(screen.getByRole("button", { name: "Forget" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
