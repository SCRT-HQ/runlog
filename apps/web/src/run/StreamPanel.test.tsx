// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { pinnedWindowCount, StreamSettings } from "./StreamPanel.tsx";
import { rememberLiveLink } from "../live/route.ts";
import type { Plan, PlanAccess } from "../sync/usePlan.ts";
import { createThemeRecordFromPreset, encodePresentationPin, resolveThemeRecord } from "@runlog/themes";
import { snapshotForBuiltin } from "../theme/appearance.ts";
import { setDeviceAppearance } from "../theme/useAppearance.ts";

const planResult = vi.hoisted(() => ({ value: null as Plan | null }));

vi.mock("../sync/usePlan.ts", () => ({
  usePlan: () => planResult.value,
}));

const planWith = (answer: PlanAccess): Plan => ({
  state:
    answer === "available" || answer === "upgrade"
      ? {
          kind: "ready",
          ownerId: "A",
          gates: answer === "upgrade",
          capabilities: { hostTables: answer === "available", waivePublisherFee: false, hostServers: false },
          offers: { servers: true, serversOpen: true, publishersOpen: true },
        }
      : answer === "error"
        ? { kind: "error", ownerId: "A", message: "offline" }
        : answer === "sign-in"
          ? { kind: "anonymous" }
          : { kind: "loading", ownerId: "A" },
  access: () => answer,
  refresh: vi.fn(async () => {}),
});

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
  planResult.value = planWith("available");
  if (documentPictureInPicture) Object.defineProperty(window, "documentPictureInPicture", documentPictureInPicture);
  else Reflect.deleteProperty(window, "documentPictureInPicture");
  vi.useRealTimers();
  setDeviceAppearance({ schemaVersion: 1, mode: "system" });
  Reflect.deleteProperty(window, "matchMedia");
});

planResult.value = planWith("available");

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

  it.each([
    ["checking" as const, /Checking your plan/],
    ["sign-in" as const, /Sign in/],
    ["upgrade" as const, /part of Plus/],
    ["error" as const, /plan could not be checked/],
  ])("shows the %s boundary instead of widget controls", (answer, message) => {
    planResult.value = planWith(answer);
    render(<StreamSettings runId="run-1" race />);

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
  });

  it("shows widget controls when access is available", () => {
    planResult.value = planWith("available");
    render(<StreamSettings runId="run-1" race />);

    expect(screen.getAllByRole("button", { name: "Copy address" }).length).toBeGreaterThan(0);
  });
});

describe("a pinned theme in a widget address", () => {
  const pinOf = (id: Parameters<typeof snapshotForBuiltin>[0]) => encodePresentationPin(snapshotForBuiltin(id));
  const apply = (id: Parameters<typeof snapshotForBuiltin>[0]) =>
    act(() => setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin(id) }));
  const clipboard = () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    return writeText;
  };
  const prefersLight = (matches: boolean) =>
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches })) });

  it("pins the applied theme's values and keeps them when the app theme changes", async () => {
    const writeText = clipboard();
    apply("ember");
    render(<StreamSettings runId="run-1" race={false} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Widget theme" }), { target: { value: "pin" } });
    expect(
      screen.getByText(
        "The address carries this theme's colors and fonts. It names no theme and no account, and does not change when you change the app's theme.",
      ),
    ).toBeTruthy();
    apply("daylight");
    fireEvent.click(firstWidgetCopy());

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`http://localhost:3000/#widget/scoreboard/run-1?bg=clear&scale=1.25&pin=${pinOf("ember")}`),
    );
  });

  it("resolves a System choice when the pin is taken, not later", async () => {
    const writeText = clipboard();
    prefersLight(true);
    render(<StreamSettings runId="run-1" race={false} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Widget theme" }), { target: { value: "pin" } });
    prefersLight(false);
    fireEvent.click(firstWidgetCopy());

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`&pin=${pinOf("daylight")}`)));
  });

  it("puts no theme name or id in the address", async () => {
    const writeText = clipboard();
    const record = createThemeRecordFromPreset({ id: "theme-secret-7", name: "Kiln Secret", presetId: "glaze" });
    if (!record.ok) throw new Error("record");
    const snapshot = resolveThemeRecord(record.value);
    if (!snapshot.ok) throw new Error("snapshot");
    act(() => setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshot.value }));
    render(<StreamSettings runId="run-1" race={false} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Widget theme" }), { target: { value: "pin" } });
    fireEvent.click(firstWidgetCopy());

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = String(writeText.mock.calls[0]![0]);
    expect(copied).toMatch(/&pin=1\.d\.[0-9a-f]{150}\./);
    expect(copied).not.toMatch(/kiln|secret|theme-secret|glaze|theme=/i);
  });

  it("makes a replacement address on Update, says the old one stays, and moves windows opened here", async () => {
    const writeText = clipboard();
    const replace = vi.fn();
    const closedReplace = vi.fn();
    const open = vi
      .spyOn(window, "open")
      .mockImplementationOnce(() => ({ closed: false, location: { replace } }) as unknown as Window)
      .mockImplementationOnce(() => ({ closed: true, location: { replace: closedReplace } }) as unknown as Window);
    apply("ember");
    render(<StreamSettings runId="run-1" race={false} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Widget theme" }), { target: { value: "pin" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[1]!);
    expect(open).toHaveBeenCalledTimes(2);

    apply("glaze");
    fireEvent.click(screen.getByRole("button", { name: "Update pinned theme" }));

    expect(replace).toHaveBeenCalledWith(`http://localhost:3000/#widget/scoreboard/run-1?bg=clear&scale=1.25&pin=${pinOf("glaze")}`);
    expect(closedReplace).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Pinned theme updated. Windows opened here now show it. Addresses you copied before keep the old theme: copy the address again and replace it in your streaming app.",
      ),
    ).toBeTruthy();
    fireEvent.click(firstWidgetCopy());
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`&pin=${pinOf("glaze")}`)));
  });

  it("forgets pinned windows once they are closed, whichever run opened them", () => {
    const first = { closed: false, location: { replace: vi.fn() } };
    const second = { closed: false, location: { replace: vi.fn() } };
    vi.spyOn(window, "open")
      .mockImplementationOnce(() => first as unknown as Window)
      .mockImplementationOnce(() => second as unknown as Window)
      .mockImplementationOnce(() => ({ closed: false, location: { replace: vi.fn() } }) as unknown as Window);
    const before = pinnedWindowCount();
    const settings = render(<StreamSettings runId="run-7" race={false} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Widget theme" }), { target: { value: "pin" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[1]!);
    expect(pinnedWindowCount()).toBe(before + 2);

    first.closed = true;
    fireEvent.click(screen.getByRole("button", { name: "Update pinned theme" }));
    expect(pinnedWindowCount()).toBe(before + 1);
    second.closed = true;
    settings.rerender(<StreamSettings runId="run-8" race={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[2]!);
    expect(pinnedWindowCount()).toBe(before + 1);
  });

  it("keeps a built-in named in the address as it always was, and following as the default", async () => {
    const writeText = clipboard();
    render(<StreamSettings runId="run-1" race={false} />);
    expect((screen.getByRole("combobox", { name: "Widget theme" }) as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Update pinned theme" })).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Widget theme" }), { target: { value: "ember" } });
    fireEvent.click(firstWidgetCopy());
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("http://localhost:3000/#widget/scoreboard/run-1?bg=clear&scale=1.25&theme=ember"),
    );
  });
});
