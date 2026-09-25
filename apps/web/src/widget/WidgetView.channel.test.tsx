// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { presentationSnapshotKey } from "@runlog/themes";
import { encodePresentationPin, type PublicLookV1 } from "@runlog/themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncError } from "../sync/client.ts";
import type { PublicLookAnswer } from "../sync/lookApi.ts";
import type { LiveOptions } from "../sync/socket.ts";
import { snapshotForBuiltin } from "../theme/appearance.ts";
import { setDeviceAppearance } from "../theme/useAppearance.ts";
import { addressOf } from "../route.ts";

const hooks = vi.hoisted(() => ({
  answers: [] as Array<PublicLookAnswer | Error>,
  asked: [] as string[],
  sockets: [] as Array<{ opts: LiveOptions; frames: string[]; follows: Array<string | null>; closed: boolean }>,
}));
vi.mock("../sync/client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sync/client.ts")>()),
  // The run itself is not what these tests are about: it stays loading.
  publicRun: () => new Promise(() => {}),
}));
vi.mock("../sync/config.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sync/config.ts")>()),
  apiBase: () => "https://runlog.test/api/",
}));
vi.mock("../sync/lookApi.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sync/lookApi.ts")>()),
  fetchPublicLook: async (_base: string, readKey: string) => {
    hooks.asked.push(readKey);
    const next = hooks.answers.shift() ?? new SyncError("offline");
    if (next instanceof Error) throw next;
    return next;
  },
}));
vi.mock("../sync/socket.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sync/socket.ts")>()),
  openLive: (opts: LiveOptions) => {
    const socket = { opts, frames: [] as string[], follows: [] as Array<string | null>, closed: false };
    hooks.sockets.push(socket);
    // Like the real one: a follow or watch that changes nothing sends nothing.
    let following: string | null = null;
    let watching: string | null = null;
    return {
      follow: (key: string | null) => {
        if (key === following) return;
        following = key;
        socket.follows.push(key);
        socket.frames.push(`follow:${key}`);
      },
      watch: (id: string | null) => {
        if (id === watching) return;
        watching = id;
        socket.frames.push(`watch:${id}`);
      },
      gesture: () => false,
      drove: () => {},
      press: () => false,
      askHeld: () => {},
      close: () => void (socket.closed = true),
      open: true,
    };
  },
}));
// A widget with no live link reads the run from this device; its plan check only has to answer.
vi.mock("../sync/usePlan.ts", () => ({ usePlan: () => ({ access: () => "checking", refresh: async () => {} }) }));

import { WidgetView } from "./WidgetView.tsx";
import { widgetFromHash } from "./route.ts";
import { useFollowedLook, writeCachedLook, type FollowedLook } from "./channel.ts";

const A = "a".repeat(32);
const B = "b".repeat(32);
const NOTE = "Theme link no longer works";
const lookOf = (id: Parameters<typeof snapshotForBuiltin>[0], revision: number): PublicLookV1 => ({
  schemaVersion: 1,
  revision,
  snapshot: snapshotForBuiltin(id),
});
const ground = (id: Parameters<typeof snapshotForBuiltin>[0]) => snapshotForBuiltin(id).colors["widget.ground"];
const bg = () => document.documentElement.style.getPropertyValue("--bg");
const route = { kind: "stats" as const, runId: "run-1", bg: "clear" as const, scale: 1.5, token: "live-token" };

beforeEach(() => {
  // A ring reads at once here: the random wait before it is tested in channel.test.ts.
  vi.spyOn(Math, "random").mockReturnValue(0);
  hooks.answers = [];
  hooks.asked = [];
  hooks.sockets = [];
});
afterEach(() => {
  vi.mocked(Math.random).mockRestore();
  cleanup();
  setDeviceAppearance({ schemaVersion: 1, mode: "system" });
  localStorage.clear();
  delete document.documentElement.dataset.widget;
  document.documentElement.style.fontSize = "";
  for (const property of [...document.documentElement.style]) document.documentElement.style.removeProperty(property);
});

describe("a widget following a theme link", () => {
  it("wears the link's look, keeps its own background and scale, and follows on the run's one socket", async () => {
    hooks.answers.push({ kind: "look", look: lookOf("glaze", 1) });
    render(<WidgetView route={{ ...route, ch: A }} />);
    await waitFor(() => expect(bg()).toBe(ground("glaze")));
    expect(document.documentElement.dataset.widget).toBe("clear");
    expect(document.documentElement.style.fontSize).toBe("24px");
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(hooks.sockets).toHaveLength(1);
    expect(hooks.sockets[0]!.frames).toEqual(["watch:run-1", `follow:${A}`]);
    expect(await hooks.sockets[0]!.opts.url()).not.toContain(A);
  });

  it("reads again when the socket rings", async () => {
    hooks.answers.push({ kind: "look", look: lookOf("glaze", 1) }, { kind: "look", look: lookOf("daylight", 2) });
    render(<WidgetView route={{ ...route, ch: A }} />);
    await waitFor(() => expect(bg()).toBe(ground("glaze")));
    expect(hooks.asked).toEqual([A]);
    act(() => hooks.sockets[0]!.opts.onLook?.({ t: "look", revision: 2 }));
    await waitFor(() => expect(bg()).toBe(ground("daylight")));
    expect(hooks.asked).toEqual([A, A]);
    expect(hooks.sockets).toHaveLength(1);
  });

  it("reads once at the start, not again on the socket's first open, and again when it opens after a drop", async () => {
    hooks.answers.push({ kind: "look", look: lookOf("glaze", 1) }, { kind: "look", look: lookOf("daylight", 2) });
    render(<WidgetView route={{ ...route, ch: A }} />);
    await waitFor(() => expect(bg()).toBe(ground("glaze")));
    const socket = hooks.sockets[0]!;
    act(() => socket.opts.onState?.(true));
    await act(async () => {});
    expect(hooks.asked).toEqual([A]);
    act(() => socket.opts.onState?.(false));
    act(() => socket.opts.onState?.(true));
    await waitFor(() => expect(bg()).toBe(ground("daylight")));
    expect(hooks.asked).toEqual([A, A]);
  });

  it.each(["clear", "solid", "none"] as const)(
    "drops to Lights down and says the link no longer works on the %s background",
    async (background) => {
      writeCachedLook(A, lookOf("glaze", 3));
      hooks.answers.push({ kind: "gone" });
      render(<WidgetView route={{ ...route, bg: background, ch: A }} />);
      await waitFor(() => expect(screen.getByText(NOTE)).toBeTruthy());
      expect(bg()).toBe(ground("lights-down"));
      expect(screen.getByText(NOTE).className).toContain("widgetNote");
      expect(localStorage.getItem(`runlog.look.v1:${A}`)).toBeNull();
    },
  );

  it("keeps the last good look through an answer that does not read, and writes no foreign value into the page", async () => {
    writeCachedLook(A, lookOf("ember", 3));
    hooks.answers.push(new SyncError("error"));
    render(<WidgetView route={{ ...route, ch: A }} />);
    await waitFor(() => expect(hooks.asked).toEqual([A]));
    expect(bg()).toBe(ground("ember"));
    expect(document.documentElement.getAttribute("style") ?? "").not.toMatch(/url\(|example\.invalid/);
  });

  it("starting offline with only another link's cache, wears Lights down and no other look", async () => {
    writeCachedLook(B, lookOf("rainbow-road", 9));
    setDeviceAppearance({ schemaVersion: 1, mode: "snapshot", snapshot: snapshotForBuiltin("glaze") });
    hooks.answers.push(new SyncError("offline"));
    render(<WidgetView route={{ ...route, ch: A }} />);
    await waitFor(() => expect(hooks.asked).toEqual([A]));
    expect(bg()).toBe(ground("lights-down"));
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it("does not read or follow the link at all under a pin", async () => {
    render(<WidgetView route={{ ...route, ch: A, pin: encodePresentationPin(snapshotForBuiltin("stardust")) }} />);
    await act(async () => {});
    expect(hooks.asked).toEqual([]);
    expect(hooks.sockets.flatMap((socket) => socket.follows)).toEqual([]);
    expect(bg()).toBe(ground("stardust"));
  });

  it("polls without a socket when the address has no live link", async () => {
    hooks.answers.push({ kind: "look", look: lookOf("glaze", 1) });
    const { token: _token, ...unlinked } = route;
    render(<WidgetView route={{ ...unlinked, ch: A }} />);
    await waitFor(() => expect(bg()).toBe(ground("glaze")));
    expect(hooks.sockets).toHaveLength(0);
  });

  it("treats a tampered key fragment as a link that does not work, and asks nothing", async () => {
    const parsed = widgetFromHash(addressOf({ pathname: "/widget/stats/run-1", search: "?t=live-token", hash: `#ch=${A}&t=stolen` }, "/"));
    expect(parsed).toMatchObject({ token: "live-token", ch: "" });
    render(<WidgetView route={parsed!} />);
    expect(screen.getByText(NOTE)).toBeTruthy();
    expect(hooks.asked).toEqual([]);
  });

  it("never shows the old key's look once the key changes under a running page", async () => {
    writeCachedLook(A, lookOf("glaze", 3));
    writeCachedLook(B, lookOf("ember", 3));
    hooks.answers.push({ kind: "look", look: lookOf("glaze", 3) });
    const renders: Array<{ ch: string; look: FollowedLook | undefined }> = [];
    const { rerender } = renderHook(
      ({ ch }: { ch: string }) => {
        const followed = useFollowedLook({ ch });
        renders.push({ ch, look: followed.look });
        return followed;
      },
      { initialProps: { ch: A } },
    );
    await waitFor(() => expect(hooks.asked).toEqual([A]));
    rerender({ ch: B });
    await waitFor(() => expect(hooks.asked).toEqual([A, B]));
    const afterChange = renders.filter((r) => r.ch === B);
    expect(afterChange.length).toBeGreaterThan(0);
    for (const r of afterChange) {
      expect(r.look?.kind === "look" ? presentationSnapshotKey(r.look.snapshot) : r.look?.kind).toBe(
        presentationSnapshotKey(snapshotForBuiltin("ember")),
      );
    }
  });
});
