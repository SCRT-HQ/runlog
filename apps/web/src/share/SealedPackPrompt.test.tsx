// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ContainerHeader, OpenResult } from "@runlog/rules-schema";
import { SealedPackPrompt } from "./SealedPackPrompt.tsx";

const open = vi.hoisted(() => vi.fn<(data: Uint8Array, key: string) => Promise<OpenResult>>());
vi.mock("@runlog/rules-schema", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@runlog/rules-schema")>()),
  open,
}));

const header = {
  v: 1,
  alg: "aes-256-gcm",
  kdf: "pbkdf2-sha256",
  iterations: 600_000,
  salt: "salt",
  iv: "iv",
} satisfies ContainerHeader;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function show(overrides: Partial<Parameters<typeof SealedPackPrompt>[0]> = {}) {
  const props = {
    data: new Uint8Array([1, 2, 3]),
    header,
    onOpened: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { ...render(<SealedPackPrompt {...props} />), props };
}

beforeEach(() => open.mockReset());
afterEach(cleanup);

describe("the sealed-pack key prompt", () => {
  it("keeps empty and whitespace-only keys from starting an open", () => {
    show();
    const input = screen.getByRole("textbox", { name: "License key" });
    const submit = screen.getByRole("button", { name: "Open it" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "   " } });
    expect(submit.disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(open).not.toHaveBeenCalled();
  });

  it("uses one guarded path for Enter and click while opening", async () => {
    const pending = deferred<OpenResult>();
    open.mockReturnValue(pending.promise);
    show();
    const input = screen.getByRole("textbox", { name: "License key" });
    fireEvent.change(input, { target: { value: "KEY-ONE" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Opening…" }));

    const submit = screen.getByRole("button", { name: "Opening…" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-busy")).toBe("true");
    expect(open).toHaveBeenCalledOnce();
    await act(async () => pending.resolve({ ok: false, reason: "wrong-key", message: "Still closed." }));
  });

  it("associates one announced failure with the field and clears it on edit", async () => {
    open.mockResolvedValue({ ok: false, reason: "wrong-key", message: "That key does not open this copy." });
    show();
    const input = screen.getByRole("textbox", { name: "License key" });
    fireEvent.change(input, { target: { value: "WRONG" } });
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    const alert = await screen.findByRole("alert");

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(alert.textContent).toBe("That key does not open this copy.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const descriptions = (input.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id));
    expect(descriptions.some((description) => description?.contains(alert))).toBe(true);

    fireEvent.change(input, { target: { value: "RIGHT" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("clears a failed key while retrying it unchanged and returns the successful result", async () => {
    const retry = deferred<OpenResult>();
    const document = { title: "The opened retry" };
    open
      .mockResolvedValueOnce({ ok: false, reason: "wrong-key", message: "That key does not open this copy." })
      .mockReturnValueOnce(retry.promise);
    const { props } = show();
    const input = screen.getByRole("textbox", { name: "License key" });
    fireEvent.change(input, { target: { value: "SAME-KEY" } });
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That key does not open this copy.");

    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    const opening = screen.getByRole("button", { name: "Opening…" }) as HTMLButtonElement;
    expect(opening.disabled).toBe(true);
    expect(opening.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(open).toHaveBeenNthCalledWith(1, props.data, "SAME-KEY");
    expect(open).toHaveBeenNthCalledWith(2, props.data, "SAME-KEY");

    await act(async () => retry.resolve({ ok: true, document }));
    expect(props.onOpened).toHaveBeenCalledOnce();
    expect(props.onOpened).toHaveBeenCalledWith(document, "SAME-KEY");
  });

  it("returns the opened document with the exact entered key", async () => {
    const document = { title: "The opened pack" };
    open.mockResolvedValue({ ok: true, document });
    const { props } = show();
    const input = screen.getByRole("textbox", { name: "License key" });
    fireEvent.change(input, { target: { value: "  Exact-Key  " } });
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));

    await act(async () => void (await Promise.resolve()));
    expect(open).toHaveBeenCalledWith(props.data, "  Exact-Key  ");
    expect(props.onOpened).toHaveBeenCalledWith(document, "  Exact-Key  ");
    expect(props.onOpened).toHaveBeenCalledOnce();
  });

  it("invalidates a pending result when Cancel is pressed", async () => {
    const pending = deferred<OpenResult>();
    open.mockReturnValue(pending.promise);
    const { props } = show();
    fireEvent.change(screen.getByRole("textbox", { name: "License key" }), { target: { value: "KEY" } });
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledOnce();

    await act(async () => pending.resolve({ ok: true, document: { old: true } }));
    expect(props.onOpened).not.toHaveBeenCalled();
  });

  it("invalidates a pending result when the prompt unmounts", async () => {
    const pending = deferred<OpenResult>();
    open.mockReturnValue(pending.promise);
    const { props, unmount } = show();
    fireEvent.change(screen.getByRole("textbox", { name: "License key" }), { target: { value: "KEY" } });
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    unmount();

    await act(async () => pending.resolve({ ok: true, document: { old: true } }));
    expect(props.onOpened).not.toHaveBeenCalled();
  });

  it("keeps the fallback title and license, privacy, and offline explanation", () => {
    show();
    expect(screen.getByRole("heading", { name: "A sealed pack" })).toBeTruthy();
    expect(screen.getByText(/license key came with it/i)).toBeTruthy();
    expect(screen.getByText(/carries your name inside it/i)).toBeTruthy();
    expect(screen.getByText(/nothing is checked online/i)).toBeTruthy();
  });
});
