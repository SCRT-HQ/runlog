// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataExport, ServerDelete } from "./DataActions.tsx";

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("data export", () => {
  it("preserves capability, single-flight, URL, byte-count, and expiry contracts", async () => {
    const pending = deferred<{ url: string; bytes: number }>();
    const onExport = vi.fn(() => pending.promise);
    const onDownload = vi.fn();
    const view = render(<DataExport disabled onExport={onExport} onDownload={onDownload} />);
    expect((screen.getByRole("button", { name: "Download everything" }) as HTMLButtonElement).disabled).toBe(true);

    view.rerender(<DataExport disabled={false} onExport={onExport} onDownload={onDownload} />);
    fireEvent.click(screen.getByRole("button", { name: "Download everything" }));
    const busy = screen.getByRole("button", { name: "Gathering…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(busy);
    expect(onExport).toHaveBeenCalledOnce();

    await act(async () => pending.resolve({ url: "/exports/synthetic.json", bytes: 1536 }));
    expect(onDownload).toHaveBeenCalledOnce();
    expect(onDownload).toHaveBeenCalledWith("/exports/synthetic.json");
    expect(screen.getByRole("status").textContent).toBe("2 KB, as JSON. The link works for fifteen minutes.");
  });

  it("announces the existing failure copy without making another request", async () => {
    const onExport = vi.fn(async () => Promise.reject(new Error("Synthetic export failed.")));
    render(<DataExport disabled={false} onExport={onExport} onDownload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Download everything" }));
    await act(async () => void (await Promise.resolve()));
    expect(onExport).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toBe("Synthetic export failed.");
    expect(screen.getByRole("button", { name: "Download everything" })).toBeTruthy();
  });

  it("preserves the requested download when the view unmounts before export settles", async () => {
    const pending = deferred<{ url: string; bytes: number }>();
    const onDownload = vi.fn();
    const view = render(<DataExport disabled={false} onExport={() => pending.promise} onDownload={onDownload} />);
    fireEvent.click(screen.getByRole("button", { name: "Download everything" }));
    view.unmount();

    await act(async () => pending.resolve({ url: "/exports/after-unmount.json", bytes: 12 }));
    expect(onDownload).toHaveBeenCalledOnce();
    expect(onDownload).toHaveBeenCalledWith("/exports/after-unmount.json");
  });
});

describe("server deletion", () => {
  it("keeps the capability rule and exact two-press destructive wording", () => {
    const onConfirm = vi.fn(async () => {});
    const view = render(<ServerDelete disabled onConfirm={onConfirm} />);
    expect((screen.getByRole("button", { name: "Delete everything of mine on the server" }) as HTMLButtonElement).disabled).toBe(true);

    view.rerender(<ServerDelete disabled={false} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete everything of mine on the server" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Yes, delete everything of mine on the server" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Delete everything of mine on the server" })).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("is busy after confirmation, blocks repeats, and announces success", async () => {
    const pending = deferred<void>();
    const onConfirm = vi.fn(() => pending.promise);
    render(<ServerDelete disabled={false} onConfirm={onConfirm} />);
    const establishedStatus = screen.getByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Delete everything of mine on the server" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete everything of mine on the server" }));

    const busy = screen.getByRole("button", { name: "Deleting…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(busy);
    expect(onConfirm).toHaveBeenCalledOnce();
    await act(async () => pending.resolve());
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toBe(establishedStatus);
    expect(establishedStatus.textContent).toBe("Done. The server holds nothing of yours now.");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("announces failure and restores the same two-press retry path", async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    render(<ServerDelete disabled={false} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete everything of mine on the server" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete everything of mine on the server" }));
    await act(async () => void (await Promise.resolve()));
    expect(screen.getByRole("status").textContent).toBe("That did not go through. Try again in a moment.");
    expect(screen.getByRole("button", { name: "Delete everything of mine on the server" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete everything of mine on the server" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
