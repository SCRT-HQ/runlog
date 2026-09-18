// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DiceTray } from "./DiceTray.tsx";

const dice3d = vi.hoisted(() => ({
  enabled: true,
  load: () => new Promise<unknown>(() => {}),
}));
const realMatchMedia = window.matchMedia;

vi.mock("./settings.ts", () => ({
  dice3dEnabled: () => dice3d.enabled,
  loadDice3d: () => dice3d.load(),
}));

afterEach(() => {
  cleanup();
  dice3d.enabled = true;
  dice3d.load = () => new Promise<unknown>(() => {});
  window.matchMedia = realMatchMedia;
  vi.useRealTimers();
});

describe("the 3D dice waiting shell", () => {
  it("shows an announced busy loading status while the optional roller loads", () => {
    render(<DiceTray dice={[{ faces: 6, display: "4", label: "d6" }]} rollId={1} />);

    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Loading…");
    expect(status.getAttribute("aria-busy")).toBe("true");
  });
});

describe("the flat dice tray", () => {
  it("uses the supplied final faces and settles immediately when motion is reduced", () => {
    dice3d.enabled = false;
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
    const settled = vi.fn();
    render(<DiceTray dice={[{ faces: 6, display: "4", label: "d6" }]} rollId={1} onSettled={settled} seed={42} />);

    expect(screen.getByLabelText("d6 showing 4").className).toContain("settled");
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("waits for the ordinary flat tumble before settling", () => {
    vi.useFakeTimers();
    dice3d.enabled = false;
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
    const settled = vi.fn();
    render(<DiceTray dice={[{ faces: 6, display: "4", label: "d6" }]} rollId={1} onSettled={settled} seed={42} />);

    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(710);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("d6 showing 4").className).toContain("settled");
  });

  it("does not settle a tumble after unmount", () => {
    vi.useFakeTimers();
    dice3d.enabled = false;
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
    const settled = vi.fn();
    const tray = render(<DiceTray dice={[{ faces: 6, display: "4", label: "d6" }]} rollId={1} onSettled={settled} />);

    tray.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(settled).not.toHaveBeenCalled();
  });
});

describe("the optional 3D dice boundary", () => {
  it("removes the loading status once its optional roller has loaded", async () => {
    dice3d.load = async () => ({ Dice3D: () => <div>3D dice</div> });
    render(<DiceTray dice={[{ faces: 6, display: "4", label: "d6" }]} rollId={1} />);

    await vi.waitFor(() => expect(screen.getByText("3D dice")).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("removes the loading status and falls back to the real flat tray when its lazy roller is unavailable", async () => {
    dice3d.load = async () => null;
    render(<DiceTray dice={[{ faces: 6, display: "4", label: "d6" }]} rollId={1} />);

    await vi.waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.getByLabelText("d6 showing 4")).toBeTruthy();
  });
});
