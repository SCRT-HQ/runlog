// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CatalogView } from "./CatalogView.tsx";
import type { CatalogEntry } from "./catalog.ts";

/**
 * The catalog card's footer, once owned and not.
 *
 * "In your packs · open" used to be one button: it read as a status until
 * you noticed it was pressable. Splitting it into a quiet chip and a real
 * "Open" button only holds up if the button still fires onOpen with the
 * right id, so that is what this exercises rather than the layout, which
 * the eye can check but a string match cannot.
 */

const ownedEntry: CatalogEntry = {
  id: "com.example.owned",
  version: "1.0.0",
  title: "Owned Pack",
  category: "everyday",
  tags: [],
  features: [],
  requires: [],
  players: 1,
  kind: "everyday · solo",
  price: "free",
  source: "bundled",
  load: async () => "",
};

const freeEntry: CatalogEntry = {
  id: "com.example.free",
  version: "1.0.0",
  title: "Free Pack",
  category: "everyday",
  tags: [],
  features: [],
  requires: [],
  players: 1,
  kind: "everyday · solo",
  price: "free",
  source: "bundled",
  load: async () => "",
};

vi.mock("./catalog.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./catalog.ts")>();
  return { ...actual, loadCatalog: vi.fn(async () => [ownedEntry, freeEntry]) };
});

afterEach(cleanup);

describe("the catalog card's footer", () => {
  it("shows an owned pack as a quiet chip plus an Open button that calls onOpen with its id", async () => {
    const onOpen = vi.fn();
    render(<CatalogView mine={new Set([ownedEntry.id])} onAdd={async () => {}} onOpen={onOpen} onBack={() => {}} />);

    const card = (await screen.findByText("Owned Pack")).closest("article");
    if (!card) throw new Error("no card rendered for the owned pack");
    expect(within(card).getByText("In your packs")).toBeTruthy();
    // The paper is one button, Docs, which opens the drawer on the summary; nothing unfolds in the card.
    expect(within(card).getByRole("button", { name: "Docs" })).toBeTruthy();
    expect(within(card).queryByText("Documents")).toBeNull();
    const openButton = within(card).getByRole("button", { name: "Open" });

    fireEvent.click(openButton);
    expect(onOpen).toHaveBeenCalledWith(ownedEntry.id);
  });

  it("offers a free, unowned pack with Add to my packs", async () => {
    render(<CatalogView mine={new Set()} onAdd={async () => {}} onOpen={() => {}} onBack={() => {}} />);

    const card = (await screen.findByText("Free Pack")).closest("article");
    if (!card) throw new Error("no card rendered for the free pack");
    expect(within(card).getByRole("button", { name: "Add to my packs" })).toBeTruthy();
    expect(within(card).queryByText("In your packs")).toBeNull();
  });
});
