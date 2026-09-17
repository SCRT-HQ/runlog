// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api, Purchase } from "../sync/client.ts";
import { PurchasesSection } from "./PurchasesSection.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const kiln: Purchase = {
  ref: "sale-kiln",
  packId: "com.example.kiln",
  title: "The Kiln",
  status: "fulfilled",
  createdAt: "2026-04-05T12:00:00Z",
  key: "KEY-KILN-123",
};

const api = (over: Partial<Pick<Api, "myPurchases" | "purchaseFile">> = {}) =>
  ({
    myPurchases: async () => [],
    purchaseFile: async () => new Uint8Array(),
    ...over,
  }) as Api;

async function settle<T>(flight: Deferred<T>, value: T) {
  await act(async () => flight.resolve(value));
}

async function fail<T>(flight: Deferred<T>, reason: unknown) {
  await act(async () => flight.reject(reason));
}

/** Records the DOM for a prop commit before PurchasesSection's passive request effect can replace it. */
function CommitText({ label, records }: { label: string; records: Array<{ label: string; text: string }> }) {
  useLayoutEffect(() => {
    records.push({ label, text: document.body.textContent ?? "" });
  }, [label, records]);
  return null;
}

describe("purchases", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("stays absent without an API, while loading, and after a successful empty response", async () => {
    const list = deferred<Purchase[]>();
    const source = api({ myPurchases: () => list.promise });
    const { rerender } = render(<PurchasesSection api={null} />);

    expect(screen.queryByRole("heading", { name: /Purchases/ })).toBeNull();
    rerender(<PurchasesSection api={source} />);
    expect(screen.queryByRole("heading", { name: /Purchases/ })).toBeNull();

    await settle(list, []);
    expect(screen.queryByRole("heading", { name: /Purchases/ })).toBeNull();
  });

  it("announces a rejected list and retries it in place", async () => {
    const first = deferred<Purchase[]>();
    const retry = deferred<Purchase[]>();
    const myPurchases = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    render(<PurchasesSection api={api({ myPurchases })} />);

    await fail(first, new Error("offline"));
    expect(screen.getByRole("heading", { name: /Purchases/ })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("could not be loaded");
    expect(screen.getByRole("status").textContent).not.toContain("empty");

    const retryButton = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(retryButton);
    expect(retryButton.hasAttribute("disabled")).toBe(true);
    expect(retryButton.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status")).toBeTruthy();

    await settle(retry, [kiln]);
    expect(screen.getByText("The Kiln")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(myPurchases).toHaveBeenCalledTimes(2);
  });

  it("removes the preceding API's rows on the first committed replacement render", async () => {
    const first = deferred<Purchase[]>();
    const second = deferred<Purchase[]>();
    const sourceA = api({ myPurchases: () => first.promise });
    const sourceB = api({ myPurchases: () => second.promise });
    const { rerender } = render(<PurchasesSection api={sourceA} />);
    await settle(first, [kiln]);
    expect(screen.getByText("The Kiln")).toBeTruthy();

    rerender(<PurchasesSection api={sourceB} />);
    expect(screen.queryByText("The Kiln")).toBeNull();
    expect(screen.queryByRole("heading", { name: /Purchases/ })).toBeNull();
  });

  it("ignores a replaced API's late list settlement", async () => {
    const first = deferred<Purchase[]>();
    const second = deferred<Purchase[]>();
    const sourceA = api({ myPurchases: () => first.promise });
    const sourceB = api({ myPurchases: () => second.promise });
    const { rerender } = render(<PurchasesSection api={sourceA} />);

    rerender(<PurchasesSection api={sourceB} />);
    await settle(first, [{ ...kiln, title: "Old account purchase" }]);
    expect(screen.queryByText("Old account purchase")).toBeNull();

    await settle(second, [{ ...kiln, ref: "sale-new", title: "New account purchase" }]);
    expect(screen.getByText("New account purchase")).toBeTruthy();
    expect(screen.queryByText("Old account purchase")).toBeNull();
  });

  it("does not revive retained rows or keys on the first commit when an API returns after null", async () => {
    const returned = deferred<Purchase[]>();
    const myPurchases = vi.fn().mockResolvedValueOnce([kiln]).mockReturnValueOnce(returned.promise);
    const source = api({ myPurchases });
    const commits: Array<{ label: string; text: string }> = [];
    const { rerender } = render(
      <>
        <PurchasesSection api={source} />
        <CommitText label="initial" records={commits} />
      </>,
    );
    await act(async () => await Promise.resolve());
    expect(screen.getByText("The Kiln")).toBeTruthy();

    rerender(
      <>
        <PurchasesSection api={null} />
        <CommitText label="null" records={commits} />
      </>,
    );
    rerender(
      <>
        <PurchasesSection api={source} />
        <CommitText label="returned" records={commits} />
      </>,
    );

    const returnedCommit = commits.find((commit) => commit.label === "returned")?.text;
    expect(returnedCommit).not.toContain("The Kiln");
    expect(returnedCommit).not.toContain("KEY-KILN-123");
  });

  it("does not revive a retained list error on the first commit when an API returns after null", async () => {
    const first = deferred<Purchase[]>();
    const returned = deferred<Purchase[]>();
    const sourceA = api({ myPurchases: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(returned.promise) });
    const commits: Array<{ label: string; text: string }> = [];
    const { rerender } = render(
      <>
        <PurchasesSection api={sourceA} />
        <CommitText label="initial" records={commits} />
      </>,
    );
    await fail(first, new Error("offline"));
    expect(screen.getByRole("status").textContent).toContain("could not be loaded");

    rerender(
      <>
        <PurchasesSection api={null} />
        <CommitText label="null" records={commits} />
      </>,
    );
    rerender(
      <>
        <PurchasesSection api={sourceA} />
        <CommitText label="returned" records={commits} />
      </>,
    );

    expect(commits.find((commit) => commit.label === "returned")?.text).not.toContain("Purchases could not be loaded");
  });

  it("ignores late list success and failure from an API's earlier lifecycle", async () => {
    const oldSuccess = deferred<Purchase[]>();
    const afterNull = deferred<Purchase[]>();
    const sourceA = api({ myPurchases: vi.fn().mockReturnValueOnce(oldSuccess.promise).mockReturnValueOnce(afterNull.promise) });
    const first = render(<PurchasesSection api={sourceA} />);
    first.rerender(<PurchasesSection api={null} />);
    first.rerender(<PurchasesSection api={sourceA} />);

    await settle(oldSuccess, [{ ...kiln, title: "Obsolete success" }]);
    expect(screen.queryByText("Obsolete success")).toBeNull();
    await settle(afterNull, [{ ...kiln, title: "Current success" }]);
    expect(screen.getByText("Current success")).toBeTruthy();
    first.unmount();

    const oldFailure = deferred<Purchase[]>();
    const afterReplacement = deferred<Purchase[]>();
    const sourceAgain = api({
      myPurchases: vi.fn().mockReturnValueOnce(oldFailure.promise).mockReturnValueOnce(afterReplacement.promise),
    });
    const replacement = api({ myPurchases: () => new Promise<Purchase[]>(() => {}) });
    const second = render(<PurchasesSection api={sourceAgain} />);
    second.rerender(<PurchasesSection api={replacement} />);
    second.rerender(<PurchasesSection api={sourceAgain} />);

    await fail(oldFailure, new Error("obsolete failure"));
    expect(screen.queryByRole("status")).toBeNull();
    await settle(afterReplacement, []);
    expect(screen.queryByRole("heading", { name: /Purchases/ })).toBeNull();
  });

  it("does not revive or settle downloads from an API's earlier lifecycle when the same API returns", async () => {
    const secondPurchase: Purchase = { ...kiln, ref: "sale-second", packId: "com.example.second", title: "Second Pack" };
    const oldSuccess = deferred<Uint8Array>();
    const oldFailure = deferred<Uint8Array>();
    const purchaseFile = vi.fn((ref: string) => (ref === kiln.ref ? oldSuccess.promise : oldFailure.promise));
    const source = api({ myPurchases: async () => [kiln, secondPurchase], purchaseFile });
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:obsolete");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { rerender } = render(<PurchasesSection api={source} />);
    await act(async () => await Promise.resolve());
    for (const button of screen.getAllByRole("button", { name: "Download the copy" })) fireEvent.click(button);
    expect(screen.getAllByRole("button", { name: "Downloading…" })).toHaveLength(2);

    const replacement = api({ myPurchases: () => new Promise<Purchase[]>(() => {}) });
    rerender(<PurchasesSection api={replacement} />);
    rerender(<PurchasesSection api={source} />);
    await act(async () => await Promise.resolve());
    const revivedBusy = screen.queryAllByRole("button", { name: "Downloading…" }).length;

    await settle(oldSuccess, new Uint8Array([9]));
    await fail(oldFailure, new Error("obsolete failure"));
    expect(revivedBusy).toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Download the copy" })).toHaveLength(2);
  });

  it("preserves purchase status, date, key, and download eligibility", async () => {
    const purchases: Purchase[] = [
      kiln,
      { ref: "sale-wait", packId: "wait", title: "Still Cooking", status: "pending", key: "WAIT-KEY" },
      { ref: "sale-gone", packId: "gone", title: "Gone Pack", status: "revoked" },
    ];
    render(<PurchasesSection api={api({ myPurchases: async () => purchases })} />);
    await act(async () => await Promise.resolve());

    expect(screen.getByText(/ready.*2026-04-05/)).toBeTruthy();
    expect(screen.getByText("KEY-KILN-123")).toBeTruthy();
    expect(screen.getByText(/being prepared/)).toBeTruthy();
    expect(screen.getByText("WAIT-KEY")).toBeTruthy();
    expect(screen.getByText(/revoked by the publisher/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Download the copy" })).toHaveLength(1);
  });

  it("disables one row during download, prevents duplicates, and saves the returned bytes", async () => {
    vi.useFakeTimers();
    const file = deferred<Uint8Array>();
    const purchaseFile = vi.fn(() => file.promise);
    const blobs: Blob[] = [];
    const revoked: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      expect(blob).toBeInstanceOf(Blob);
      blobs.push(blob as Blob);
      return "blob:purchase";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => revoked.push(url));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<PurchasesSection api={api({ myPurchases: async () => [kiln], purchaseFile })} />);
    await act(async () => await Promise.resolve());

    const button = screen.getByRole("button", { name: "Download the copy" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(purchaseFile).toHaveBeenCalledTimes(1);
    expect(purchaseFile).toHaveBeenCalledWith("sale-kiln");
    expect(screen.getByRole("button", { name: "Downloading…" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Downloading…" }).getAttribute("aria-busy")).toBe("true");

    await settle(file, new Uint8Array([4, 5, 6]));
    expect(blobs).toHaveLength(1);
    expect(blobs[0]?.type).toBe("application/octet-stream");
    expect(blobs[0]?.size).toBe(3);
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.href).toBe("blob:purchase");
    expect(anchor.download).toBe("com.example.kiln.rlpack");
    expect(screen.getByRole("button", { name: "Download the copy" }).hasAttribute("disabled")).toBe(false);

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(revoked).toEqual(["blob:purchase"]);
  });

  it("names a row's download error, clears it on retry, and clears it after success", async () => {
    const first = deferred<Uint8Array>();
    const retry = deferred<Uint8Array>();
    const purchaseFile = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retry");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<PurchasesSection api={api({ myPurchases: async () => [kiln], purchaseFile })} />);
    await act(async () => await Promise.resolve());

    fireEvent.click(screen.getByRole("button", { name: "Download the copy" }));
    await fail(first, new Error("The vault is asleep."));
    expect(screen.getByRole("status").textContent).toBe("The Kiln: The vault is asleep.");

    fireEvent.click(screen.getByRole("button", { name: "Download the copy" }));
    expect(screen.queryByRole("status")).toBeNull();
    await settle(retry, new Uint8Array([1]));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("uses the generic named fallback for a non-Error download rejection", async () => {
    render(
      <PurchasesSection
        api={api({
          myPurchases: async () => [kiln],
          purchaseFile: async () => Promise.reject("no detail"),
        })}
      />,
    );
    await act(async () => await Promise.resolve());

    fireEvent.click(screen.getByRole("button", { name: "Download the copy" }));
    await act(async () => await Promise.resolve());
    expect(screen.getByRole("status").textContent).toBe("The Kiln: The copy could not be fetched.");
    expect(screen.getByRole("button", { name: "Download the copy" }).hasAttribute("disabled")).toBe(false);
  });

  it("does not download or report a late old-account file after API replacement", async () => {
    const file = deferred<Uint8Array>();
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:old");
    const sourceA = api({ myPurchases: async () => [kiln], purchaseFile: () => file.promise });
    const sourceB = api({ myPurchases: async () => [] });
    const { rerender } = render(<PurchasesSection api={sourceA} />);
    await act(async () => await Promise.resolve());
    fireEvent.click(screen.getByRole("button", { name: "Download the copy" }));

    rerender(<PurchasesSection api={sourceB} />);
    await settle(file, new Uint8Array([9]));
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not download a late file after unmount", async () => {
    const file = deferred<Uint8Array>();
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:late");
    const { unmount } = render(<PurchasesSection api={api({ myPurchases: async () => [kiln], purchaseFile: () => file.promise })} />);
    await act(async () => await Promise.resolve());
    fireEvent.click(screen.getByRole("button", { name: "Download the copy" }));
    unmount();

    await settle(file, new Uint8Array([9]));
    expect(create).not.toHaveBeenCalled();
  });
});
