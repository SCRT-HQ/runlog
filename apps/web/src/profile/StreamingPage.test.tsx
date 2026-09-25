// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LookChannelContext, NO_LOOK_CHANNEL, type LookChannelView } from "../theme/follow/LookChannelProvider.tsx";
import { StreamingPage } from "./StreamingPage.tsx";

const HERE = "lk_AAAAAAAAAAAAAAAA";
const THERE = "lk_BBBBBBBBBBBBBBBB";
const AT = "2026-09-25T10:00:00.000Z";
const links = [
  { id: HERE, revision: 3, createdAt: AT, updatedAt: AT, publishedAt: AT },
  { id: THERE, revision: 0, createdAt: AT, updatedAt: AT, publishedAt: null },
];
const view = (extra: Partial<LookChannelView> = {}): LookChannelView => ({
  ...NO_LOOK_CHANNEL,
  available: true,
  state: { kind: "following" },
  channel: { id: HERE, readKey: "r".repeat(32), checking: false, published: true },
  list: vi.fn(async () => links),
  relink: vi.fn(async () => "ok" as const),
  takeOver: vi.fn(async () => "ok" as const),
  revoke: vi.fn(async () => true),
  ...extra,
});
const show = (v: LookChannelView) =>
  render(
    <LookChannelContext.Provider value={v}>
      <StreamingPage />
    </LookChannelContext.Provider>,
  );

afterEach(cleanup);

describe("the account's theme links", () => {
  it("lists which device publishes each link and when it last did", async () => {
    show(view());
    expect(screen.getByRole("heading", { name: "Streaming" })).toBeTruthy();
    expect(await screen.findByText("This device")).toBeTruthy();
    expect(screen.getByText("Another device")).toBeTruthy();
    expect(screen.getByText(/Last published/)).toBeTruthy();
    expect(screen.getByText(/Not published yet/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("r".repeat(32));
  });

  it("makes a new link for this device and says what that means for copied addresses", async () => {
    const v = view();
    show(v);
    fireEvent.click(await screen.findByRole("button", { name: "New link" }));
    await waitFor(() => expect(v.relink).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/New link made\. Copy the widget addresses again/)).toBeTruthy();
  });

  it("calls a link this device holds but another device publishes another device's, with Use this device", async () => {
    const v = view({ state: { kind: "elsewhere" } });
    show(v);
    await screen.findAllByRole("listitem");
    expect(screen.queryByText("This device")).toBeNull();
    expect(screen.getAllByText("Another device")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "New link" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Use this device" })[0]!);
    await waitFor(() => expect(v.takeOver).toHaveBeenCalledWith(HERE));
  });

  it("moves another device's link here", async () => {
    const v = view();
    show(v);
    fireEvent.click(await screen.findByRole("button", { name: "Use this device" }));
    await waitFor(() => expect(v.takeOver).toHaveBeenCalledWith(THERE));
    expect(await screen.findByText("This device now publishes the theme link.")).toBeTruthy();
  });

  it("asks once more before revoking, and Cancel leaves the link alone", async () => {
    const v = view();
    show(v);
    const [first] = await screen.findAllByRole("button", { name: "Revoke" });
    fireEvent.click(first!);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(v.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Revoke this link" }));
    await waitFor(() => expect(v.revoke).toHaveBeenCalledWith(HERE));
    expect(await screen.findByText("Revoked. Widgets on that link show the built-in look.")).toBeTruthy();
  });

  it("says Loading… while it asks, and offers Try again when the list cannot be read", async () => {
    let fail!: (e: Error) => void;
    const list = vi.fn(() => new Promise<never>((_resolve, reject) => (fail = reject)));
    show(view({ list }));
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Loading…");
    fail(new Error("offline"));
    await waitFor(() => expect(status.textContent).toBe("Theme links could not be read just now."));
    expect(screen.getByRole("status")).toBe(status);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("says plainly where there is nothing and where links cannot be made", async () => {
    show(view({ list: vi.fn(async () => []) }));
    expect(
      await screen.findByText("No theme links yet. In a run's Stream settings, choose Follow this device from anywhere."),
    ).toBeTruthy();
    cleanup();
    show(NO_LOOK_CHANNEL);
    expect(screen.getByText("Theme links need the hosted copy of Runlog and a signed-in account.")).toBeTruthy();
  });

  it("claims nothing that did not happen: a refused new link and a failed revoke say so plainly", async () => {
    const v = view({ relink: vi.fn(async () => "plan" as const), revoke: vi.fn(async () => false) });
    show(v);
    fireEvent.click(await screen.findByRole("button", { name: "New link" }));
    expect(await screen.findByText("Following this device from anywhere is part of Plus.")).toBeTruthy();
    expect(screen.queryByText(/New link made/)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Revoke this link" }));
    expect(await screen.findByText("Could not revoke the theme link. Try again.")).toBeTruthy();
    expect(screen.queryByText(/^Revoked\./)).toBeNull();
  });

  it("gives each failed action its own line, in a live region that was there from the start", async () => {
    const v = view({ relink: vi.fn(async () => "error" as const), takeOver: vi.fn(async () => "gone" as const) });
    const { container } = show(v);
    const said = container.querySelector('div[aria-live="polite"]');
    expect(said).not.toBeNull();
    expect(said!.textContent).toBe("");
    fireEvent.click(await screen.findByRole("button", { name: "New link" }));
    await waitFor(() => expect(said!.textContent).toBe("Could not make the theme link. Try again."));
    fireEvent.click(screen.getByRole("button", { name: "Use this device" }));
    await waitFor(() => expect(said!.textContent).toBe("Could not move the theme link to this device. Try again."));
    expect(container.querySelector('div[aria-live="polite"]')).toBe(said);
  });
});
