// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MarketplaceView } from "./MarketplaceView.tsx";
import { DocDrawerProvider } from "../docs/DocDrawer.tsx";
import { feedState, type MarketplaceEntry } from "./marketplace.ts";

/**
 * The browsing card, and what it is for.
 *
 * A card answers four questions in one order on every card: what is it,
 * why would I try it, what do I need, how do I get it. What is exercised
 * here is that order, the one action each state offers, and the states
 * that are easy to draw as each other: a feed that did not answer is not
 * an empty catalog, and an add that failed is not an add that worked.
 */

const base = {
  version: "1.0.0",
  category: "everyday",
  tags: [] as string[],
  features: [],
  requires: [],
  players: 1,
  tablePlays: true,
  blurb: "everyday · solo",
  kind: "pack" as const,
  price: "free" as const,
  source: "bundled" as const,
  load: async () => "",
};

const ownedEntry: MarketplaceEntry = { ...base, id: "com.example.owned", title: "Owned Pack", features: ["solo"] };

const freeEntry: MarketplaceEntry = {
  ...base,
  id: "com.example.free",
  title: "Free Pack",
  description: "A premise, in one line.",
  category: "games",
  players: 6,
  tags: ["dice", "race"],
  requires: [
    { label: "a chat that can answer", kind: "other", optional: false },
    { label: "something to be bad at", kind: "other", optional: false },
    { label: "a second screen", kind: "other", optional: true },
  ],
};

const setupEntry: MarketplaceEntry = {
  ...base,
  id: "com.example.setup",
  title: "A Loadout",
  kind: "setup",
  source: "listing",
};

const pricedEntry: MarketplaceEntry = {
  ...base,
  id: "com.example.priced",
  title: "A Priced Pack",
  source: "listing",
  price: { amount: 500, currency: "usd", display: "$5.00" },
  publisher: { id: "org_example", name: "Example Press" },
};

vi.mock("./marketplace.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./marketplace.ts")>();
  return {
    ...actual,
    loadMarketplace: vi.fn(async () => [ownedEntry, freeEntry, setupEntry, pricedEntry]),
    feedState: vi.fn(() => "none" as const),
  };
});

beforeEach(() => {
  vi.mocked(feedState).mockReturnValue("none");
  try {
    localStorage.clear();
  } catch {
    /* a private window under test is still a test */
  }
});
afterEach(cleanup);

const view = (props: Partial<Parameters<typeof MarketplaceView>[0]> = {}) =>
  render(<MarketplaceView mine={new Set()} onAdd={async () => {}} onOpen={() => {}} onBack={() => {}} {...props} />);

const cardFor = async (title: string) => {
  const card = (await screen.findByText(title)).closest("article");
  if (!card) throw new Error(`no card rendered for ${title}`);
  return card;
};

describe("what a browsing card says, and in what order", () => {
  it("puts the title, the premise, why, what it needs and how to get it in that order", async () => {
    view();
    const card = await cardFor("Free Pack");

    const text = [...card.querySelectorAll("h3, p, .chip, button")].map((n) => n.textContent?.trim() ?? "");
    // A control that swaps its label while it works carries both, so the
    // action is matched by what it starts with and the rest exactly.
    const order = [
      (t: string) => t === "Free Pack", // what is it
      (t: string) => t === "A premise, in one line.",
      (t: string) => t === "games", // why would I try it
      (t: string) => t === "Up to 6 players",
      (t: string) => t === "Needs: a chat that can answer, something to be bad at", // what do I need
      (t: string) => t === "Free", // how do I get it
      (t: string) => t.startsWith("Add"),
    ].map((match) => text.findIndex(match));
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("names only the required things on the needs line, and folds the optional one away", async () => {
    view();
    const card = await cardFor("Free Pack");

    const needs = within(card).getByText(/^Needs:/).parentElement;
    expect(needs?.textContent).toContain("a chat that can answer");
    expect(needs?.textContent).toContain("something to be bad at");
    expect(needs?.textContent).not.toContain("a second screen");

    const fold = card.querySelector("details.marketFold");
    expect(fold).toBeTruthy();
    expect((fold as HTMLDetailsElement).open).toBe(false);
    expect(within(fold as HTMLElement).getByText("Optional")).toBeTruthy();
    expect(within(fold as HTMLElement).getByText("a second screen")).toBeTruthy();
  });

  it("leaves the needs line off a pack that requires nothing", async () => {
    view();
    const card = await cardFor("Owned Pack");
    expect(within(card).queryByText(/^Needs:/)).toBeNull();
  });

  it("says Solo where the pack seats one, and leaves the badge off where it declares no seats", async () => {
    view();
    expect(within(await cardFor("Owned Pack")).getByText("Solo")).toBeTruthy();

    cleanup();
    vi.mocked(await import("./marketplace.ts")).loadMarketplace.mockResolvedValueOnce([{ ...ownedEntry, players: 0 as unknown as number }]);
    view();
    const card = await cardFor("Owned Pack");
    expect(within(card).queryByText("Solo")).toBeNull();
    expect(within(card).queryByText(/players$/)).toBeNull();
  });

  it("carries no tag cloud of its own; tags are a filter", async () => {
    view();
    const card = await cardFor("Free Pack");
    expect(within(card).queryByRole("button", { name: "dice" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "race" })).toBeNull();
  });
});

describe("the one action a card offers", () => {
  it("shows an owned pack as Owned plus an Open button that calls onOpen with its id", async () => {
    const onOpen = vi.fn();
    view({ mine: new Set([ownedEntry.id]), onOpen });
    const card = await cardFor("Owned Pack");

    expect(within(card).getByText("Owned")).toBeTruthy();
    // The paper is one button, which opens the drawer on the summary; nothing unfolds in the card.
    expect(within(card).getByRole("button", { name: "Read the summary" })).toBeTruthy();
    expect(within(card).queryByText("Documents")).toBeNull();
    expect(within(card).queryByRole("button", { name: "Add" })).toBeNull();

    fireEvent.click(within(card).getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith(ownedEntry.id);
  });

  it("offers a free, unowned pack with Add", async () => {
    view();
    const card = await cardFor("Free Pack");
    expect(within(card).getByRole("button", { name: "Add" })).toBeTruthy();
    expect(within(card).queryByText("Owned")).toBeNull();
  });

  it("offers a priced listing its price, and Sign in to buy where nobody is signed in", async () => {
    const onBuy = vi.fn(async () => {});
    view({ onBuy });
    const bought = await cardFor("A Priced Pack");
    expect(within(bought).getByText("$5.00")).toBeTruthy();
    fireEvent.click(within(bought).getByRole("button", { name: "Buy $5.00" }));
    expect(onBuy).toHaveBeenCalled();

    cleanup();
    view();
    const card = await cardFor("A Priced Pack");
    expect(within(card).getByRole("button", { name: "Sign in to buy" })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /^Buy/ })).toBeNull();
  });

  it("offers Update beside Open where the marketplace has a newer version", async () => {
    const onUpdate = vi.fn(async () => {});
    view({ mine: new Set([ownedEntry.id]), updatable: new Set([ownedEntry.id]), onUpdate });
    const card = await cardFor("Owned Pack");
    expect(within(card).getByRole("button", { name: "Open" })).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Update" }));
    expect(onUpdate).toHaveBeenCalled();

    cleanup();
    view({ mine: new Set([ownedEntry.id]), onUpdate });
    expect(within(await cardFor("Owned Pack")).queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("says Adding… while the add is in flight, and puts what went wrong under the card when it is not", async () => {
    let settle: (() => void) | null = null;
    const onAdd = vi.fn(() => new Promise<void>((_, reject) => (settle = () => reject(new Error("The disk said no.")))));
    view({ onAdd });
    const card = await cardFor("Free Pack");

    fireEvent.click(within(card).getByRole("button", { name: "Add" }));
    const busy = within(card).getByRole("button", { name: "Adding…" });
    expect(busy).toHaveProperty("disabled", true);

    await act(async () => {
      settle?.();
    });
    await waitFor(() => expect(within(card).getByText("The disk said no.")).toBeTruthy());
    expect(within(card).getByRole("button", { name: "Add" })).toBeTruthy();
  });

  it("takes one acquisition at a time: a second card's Add is refused while one is in flight", async () => {
    let settle: (() => void) | null = null;
    const onAdd = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    const onBuy = vi.fn(async () => {});
    view({ onAdd, onBuy });

    const first = await cardFor("Free Pack");
    fireEvent.click(within(first).getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledTimes(1);

    // Every other card's action goes with it, whatever the action is, and a
    // press that gets through anyway never reaches the library.
    const priced = await cardFor("A Priced Pack");
    expect(within(priced).getByRole("button", { name: "Buy $5.00" })).toHaveProperty("disabled", true);

    const second = await cardFor("Owned Pack");
    const secondAdd = within(second).getByRole("button", { name: "Add" });
    expect(secondAdd).toHaveProperty("disabled", true);
    fireEvent.click(secondAdd);
    expect(onAdd).toHaveBeenCalledTimes(1);

    // Only the attempt that took the page clears it; the other card comes back.
    await act(async () => {
      settle?.();
    });
    await waitFor(() => expect(within(second).getByRole("button", { name: "Add" })).toHaveProperty("disabled", false));
  });

  it("offers a deck to a pack and not to a setup", async () => {
    // A setup is what a tool is set to while a run lasts. It has no moves,
    // no counters and no resources, so there is nothing to lay out on keys.
    view();
    expect(within(await cardFor("Free Pack")).getByText("Stream Deck profile")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Setups/ }));
    expect(within(await cardFor("A Loadout")).queryByText("Stream Deck profile")).toBeNull();
  });
});

describe("the filters the sidebar leads with", () => {
  it("starts with activity, solo or group, and free or owned, and holds the rest behind More filters", async () => {
    view();
    await screen.findByText("Free Pack");
    const side = screen.getByRole("complementary", { name: "Search and filters" });

    const titles = [...side.querySelectorAll(".facetTitle, summary")].map((n) => n.textContent?.trim() ?? "");
    expect(titles.slice(0, 3)).toEqual(["Activity", "Solo or group", "Free or owned"]);
    expect(titles).toContain("More filters");
    expect(titles.indexOf("More filters")).toBeGreaterThan(titles.indexOf("Free or owned"));

    const more = side.querySelector("details.marketMore") as HTMLDetailsElement;
    expect(more.open).toBe(false);
    expect(within(more).getByText("Tags")).toBeTruthy();
    expect(within(more).getByText("How it plays")).toBeTruthy();
  });

  it("narrows to a group pack and back", async () => {
    view();
    await screen.findByText("Free Pack");

    fireEvent.click(screen.getByRole("button", { name: /^Group/ }));
    expect(screen.getByText("Free Pack")).toBeTruthy();
    expect(screen.queryByText("Owned Pack")).toBeNull();
    expect(screen.getByText("1 match")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Owned Pack")).toBeTruthy();
  });

  it("counts the catalog when nothing is set", async () => {
    view();
    await screen.findByText("Free Pack");
    // Three packs; the setup is behind the other tab.
    expect(screen.getByText("3 packs")).toBeTruthy();
  });

  it("keeps the query and the filters across opening the summary and closing it", async () => {
    const readable: MarketplaceEntry = {
      ...freeEntry,
      load: async () => {
        throw new Error("a listing's text is not fetched to draw a card");
      },
      about: async () => ({ kind: "summary" as const, layout: "book" as const, title: "Free Pack", blocks: [] }),
    };
    vi.mocked(await import("./marketplace.ts")).loadMarketplace.mockResolvedValueOnce([ownedEntry, readable]);
    render(
      <DocDrawerProvider>
        <MarketplaceView mine={new Set()} onAdd={async () => {}} onOpen={() => {}} onBack={() => {}} />
      </DocDrawerProvider>,
    );
    await screen.findByText("Free Pack");

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "free" } });
    fireEvent.click(screen.getByRole("button", { name: /^Group/ }));

    const card = await cardFor("Free Pack");
    fireEvent.click(within(card).getByRole("button", { name: "Read the summary" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(screen.getByRole("searchbox")).toHaveProperty("value", "free");
    expect(screen.getByRole("button", { name: /^Group/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Free Pack")).toBeTruthy();
  });
});

describe("what the page says when there is nothing to show", () => {
  it("says a feed that did not answer did not answer, above the packs that shipped", async () => {
    vi.mocked(feedState).mockReturnValue("failed");
    view();
    const line = await screen.findByText("The marketplace did not answer. The packs that ship with the app are here.");
    // Never an empty catalog: the bundled cards are still below the line.
    const cards = document.querySelectorAll("article.marketCard");
    expect(cards.length).toBeGreaterThan(0);
    expect(line.compareDocumentPosition(cards[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("drops the first sentence where the browser knows it is offline", async () => {
    vi.mocked(feedState).mockReturnValue("failed");
    const online = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    try {
      view();
      expect(await screen.findByText("The packs that ship with the app are here.")).toBeTruthy();
      expect(screen.queryByText(/did not answer/)).toBeNull();
    } finally {
      if (online) Object.defineProperty(Navigator.prototype, "onLine", online);
      delete (navigator as unknown as Record<string, unknown>)["onLine"];
    }
  });

  it("says nothing matches, and keeps the way to clear the filters in reach", async () => {
    view();
    await screen.findByText("Free Pack");

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nothing here is called this" } });
    expect(screen.getByText("Nothing matches. Clear the filters to see everything.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Free Pack")).toBeTruthy();
  });

  it("says Loading… while the catalog is on its way", async () => {
    let settle: ((entries: MarketplaceEntry[]) => void) | null = null;
    vi.mocked(await import("./marketplace.ts")).loadMarketplace.mockReturnValueOnce(
      new Promise<MarketplaceEntry[]>((resolve) => (settle = resolve)),
    );
    const { container } = view();
    expect(container.querySelector(".marketLoading")?.textContent).toBe("Loading…");
    await act(async () => {
      settle?.([freeEntry]);
    });
    expect(container.querySelector(".marketLoading")).toBeNull();
  });
});
