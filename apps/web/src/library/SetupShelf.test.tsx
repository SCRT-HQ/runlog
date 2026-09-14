// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { SetupShelf } from "./SetupShelf.tsx";
import type { StoredSetup } from "../storage/db.ts";

/**
 * The shelf of setups somebody keeps.
 *
 * The interesting part is not the list; it is what happens when the file
 * somebody picks is not the thing they think it is. A person choosing a
 * file has no reason to know that a pack and a setup are different
 * documents, and "that is not a setup" about a perfectly good pack tells
 * them nothing they can act on.
 */

const shelf: { rows: StoredSetup[]; saved: StoredSetup[]; forgotten: string[] } = { rows: [], saved: [], forgotten: [] };

vi.mock("../storage/db.ts", () => ({
  listSetups: async () => shelf.rows,
  saveSetup: async (s: StoredSetup) => {
    shelf.saved.push(s);
    shelf.rows = [...shelf.rows.filter((r) => r.id !== s.id), s];
  },
  forgetSetup: async (id: string) => {
    shelf.forgotten.push(id);
    shelf.rows = shelf.rows.filter((r) => r.id !== id);
  },
}));

vi.mock("../control/setups.ts", () => ({ shippedSetups: async () => [{ id: "a" }, { id: "b" }] }));

const SETUP = [
  "kind: setup",
  "schemaVersion: 1",
  "id: com.example.setups.mine",
  'version: "1.0.0"',
  "title: Mine",
  "tool: TarnishedTool",
  "ops:",
  "  - { op: flag.set, args: { name: player.noRoll, value: true } }",
].join("\n");

const PACK = "schemaVersion: 1\nid: com.example.pack\nversion: \"1.0.0\"\ntitle: A pack\n";

/** A file the input will hand over, without a real file picker. */
const pick = async (name: string, text: string) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([text], name, { type: "text/plain" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

beforeEach(() => {
  shelf.rows = [];
  shelf.saved = [];
  shelf.forgotten = [];
});
afterEach(cleanup);

describe("the setup shelf", () => {
  it("says what a file is when it is the other kind of document", async () => {
    render(<SetupShelf />);
    await screen.findByText(/None of your own yet/);
    await pick("kiln.yaml", PACK);
    // Not "that is not a setup": a pack is a thing this app has a shelf
    // for, and saying which shelf is the whole of the help needed.
    await screen.findByText(/kiln.yaml is a pack, not a setup/);
    expect(shelf.saved).toEqual([]);
  });

  it("keeps a setup, by what the document says rather than by the filename", async () => {
    render(<SetupShelf />);
    await screen.findByText(/None of your own yet/);
    await pick("anything.yaml", SETUP);
    await waitFor(() => expect(shelf.saved).toHaveLength(1));
    expect(shelf.saved[0]).toMatchObject({ id: "com.example.setups.mine", title: "Mine", version: "1.0.0", tool: "TarnishedTool" });
    // The text as it arrived, so a later build that understands more of
    // the format than this one can read it again.
    expect(shelf.saved[0]?.source).toBe(SETUP);
  });

  it("says which tool it is for, since that is what decides where it fits", async () => {
    shelf.rows = [
      { id: "x", title: "Bare-handed", version: "1.0.0", tool: "TarnishedTool", source: SETUP, format: "yaml", importedAt: "", updatedAt: "" },
    ];
    render(<SetupShelf />);
    await screen.findByText(/TarnishedTool/);
    expect(screen.getByText("Bare-handed")).toBeTruthy();
  });

  it("counts the ones that ship, so an empty shelf does not read as nothing at all", async () => {
    render(<SetupShelf />);
    await screen.findByText(/2 ship with the app/);
  });
});
