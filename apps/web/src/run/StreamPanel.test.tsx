// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StreamSettings } from "./StreamPanel.tsx";
import { rememberLiveLink } from "../live/route.ts";

const plan = vi.hoisted(() => ({ gates: false as boolean, loaded: true, can: (): boolean => true }));

vi.mock("../sync/usePlan.ts", () => ({
  usePlan: () => plan,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const firstWidgetCopy = () => screen.getAllByRole("button", { name: /^(Copy address|Copied)$/ })[0]!;
const documentPictureInPicture = Object.getOwnPropertyDescriptor(window, "documentPictureInPicture");

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  plan.gates = false;
  plan.can = () => true;
  if (documentPictureInPicture) Object.defineProperty(window, "documentPictureInPicture", documentPictureInPicture);
  else Reflect.deleteProperty(window, "documentPictureInPicture");
  vi.useRealTimers();
});

describe("a failed stream address copy", () => {
  it("gives persistent retry guidance while retaining the widget open action", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<StreamSettings runId="run-1" race={false} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Copy address" })[0]!);

    await waitFor(() => {
      const status = screen.getByRole("status");
      expect(status.textContent).toMatch(/couldn't copy.*try again/i);
    });
    expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(7);
  });

  it("keeps a later failure current when an earlier write resolves out of order", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const writeText = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<StreamSettings runId="run-1" race={false} />);

    fireEvent.click(firstWidgetCopy());
    fireEvent.click(firstWidgetCopy());
    second.reject(new Error("denied"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/couldn't copy.*try again/i));

    first.resolve();
    await Promise.resolve();
    expect(screen.getByRole("status").textContent).toMatch(/couldn't copy.*try again/i);
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("replaces a success with a same-target failure and keeps the guidance after the old success interval", async () => {
    vi.useFakeTimers();
    const first = deferred<void>();
    const second = deferred<void>();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) },
    });
    render(<StreamSettings runId="run-1" race={false} />);

    fireEvent.click(firstWidgetCopy());
    first.resolve();
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
    fireEvent.click(firstWidgetCopy());
    second.reject(new Error("denied"));
    await vi.waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/couldn't copy.*try again/i));

    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
    vi.advanceTimersByTime(1_501);
    expect(screen.getByRole("status").textContent).toMatch(/couldn't copy.*try again/i);
    vi.useRealTimers();
  });

  it("clears a persistent failure only when a later retry succeeds", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) },
    });
    render(<StreamSettings runId="run-1" race={false} />);

    fireEvent.click(firstWidgetCopy());
    first.reject(new Error("denied"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/couldn't copy.*try again/i));
    fireEvent.click(firstWidgetCopy());
    second.resolve();
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());

    expect(screen.getByRole("status").textContent).toBe("Copied.");
  });

  it("ignores an old success when run A changes to B and back to A before it resolves", async () => {
    const oldWrite = deferred<void>();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockReturnValue(oldWrite.promise) } });
    const settings = render(<StreamSettings runId="run-a" race={false} />);

    fireEvent.click(firstWidgetCopy());
    settings.rerender(<StreamSettings runId="run-b" race={false} />);
    settings.rerender(<StreamSettings runId="run-a" race={false} />);
    await act(async () => {
      oldWrite.resolve();
      await oldWrite.promise;
    });

    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("ignores an old failure after a run change", async () => {
    const oldWrite = deferred<void>();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockReturnValue(oldWrite.promise) } });
    const settings = render(<StreamSettings runId="run-a" race={false} />);

    fireEvent.click(firstWidgetCopy());
    settings.rerender(<StreamSettings runId="run-b" race={false} />);
    await act(async () => {
      oldWrite.reject(new Error("denied"));
      await Promise.resolve();
    });

    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("clears settled feedback when the settings receive another run", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const settings = render(<StreamSettings runId="run-a" race={false} />);

    fireEvent.click(firstWidgetCopy());
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Copied."));
    settings.rerender(<StreamSettings runId="run-b" race={false} />);

    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("does not create a timer or feedback after an unmounted pending write resolves", async () => {
    vi.useFakeTimers();
    const oldWrite = deferred<void>();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockReturnValue(oldWrite.promise) } });
    const settings = render(<StreamSettings runId="run-a" race={false} />);

    fireEvent.click(firstWidgetCopy());
    settings.unmount();
    await act(async () => {
      oldWrite.resolve();
      await oldWrite.promise;
    });

    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe("stream widget addresses", () => {
  it("keeps the locally opened route token-free, then carries a stored token only for another machine", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    rememberLiveLink("run-1", "https://hosted.example/#run/run-1?t=synthetic-live-token");
    render(<StreamSettings runId="run-1" race={false} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "For another machine" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Widget background" }), { target: { value: "none" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Widget theme" }), { target: { value: "ember" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Widget size" }), { target: { value: "1.5" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Copy address" })[0]!);

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("http://localhost:3000/#widget/scoreboard/run-1?bg=none&scale=1.5&theme=ember"),
    );
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "For another machine" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0]!);
    expect(open).toHaveBeenCalledWith(
      "http://localhost:3000/#widget/scoreboard/run-1?bg=none&scale=1.5&theme=ember&t=synthetic-live-token",
      "runlog-widget-scoreboard",
      "popup=yes,width=576,height=528",
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy dock address" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("http://localhost:3000/#dock/controls/run-1"));
  });

  it("keeps race widgets conditional and explains unavailable floating controls", () => {
    const { rerender } = render(<StreamSettings runId="run-1" race={false} />);

    expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(7);
    expect(screen.queryByText("Race", { selector: "strong" })).toBeNull();
    expect(screen.getByRole("button", { name: "Float the controls" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/needs Chrome or Edge/)).toBeTruthy();

    rerender(<StreamSettings runId="run-1" race />);
    expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(8);
    expect(screen.getByText("Race", { selector: "strong" })).toBeTruthy();
  });

  it("calls the supplied Float callback once when document Picture-in-Picture is available", () => {
    Object.defineProperty(window, "documentPictureInPicture", {
      configurable: true,
      value: { requestWindow: vi.fn() },
    });
    const onControls = vi.fn();
    render(<StreamSettings runId="run-1" race={false} onControls={onControls} />);

    const float = screen.getByRole("button", { name: "Float the controls" });
    expect(float.hasAttribute("disabled")).toBe(false);
    fireEvent.click(float);
    expect(onControls).toHaveBeenCalledTimes(1);
  });

  it("shows the Plus gate instead of widget controls where the plan disallows them", () => {
    plan.gates = true;
    plan.can = () => false;
    render(<StreamSettings runId="run-1" race />);

    expect(screen.getByText(/part of Plus/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
  });
});
