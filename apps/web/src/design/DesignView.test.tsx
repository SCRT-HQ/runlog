// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeAccessibleName } from "dom-accessibility-api";
import { loadDraft, saveDraft } from "../storage/db.ts";
import { blankPack, type Draft } from "./draft.ts";
import { DesignView } from "./DesignView.tsx";

vi.mock("../storage/db.ts", () => ({
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
}));

// react-dom looks for this flag before it will run effects inside act();
// without it, the load effect fires but React warns as though it did not.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The Designer used to load whatever draft was last open and jump straight
 * into it, so pressing the header's Designer button after finishing one
 * pack landed you back inside it, not the blank start a second pack needs.
 * These render the real load effect (mocking only the storage it reads
 * from) and drive the door's buttons, because the bug lived in the
 * combination of what loaded and what got shown, not in either alone.
 */
describe("which pack the Designer opens on", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    history.replaceState(null, "", "/");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(saveDraft).mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(loadDraft).mockReset();
    vi.mocked(saveDraft).mockReset();
  });

  async function mount(stored: Draft | null) {
    vi.mocked(loadDraft).mockResolvedValue(stored ? { id: "current", pack: stored, updatedAt: "2026-01-01T00:00:00Z" } : null);
    await act(async () => {
      root.render(<DesignView />);
    });
  }

  const buttonLabeled = (text: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text);
  /** The editor proper, as against the door: the six sections are always on screen in it. */
  const editing = () => container.querySelector(".designNav") !== null;

  it("asks which pack when a real draft is waiting", async () => {
    await mount({ ...blankPack(), title: "Two-Line Days" });
    expect(container.textContent).toContain("Which pack?");
    expect(container.textContent).toContain("Continue editing Two-Line Days");
    expect(buttonLabeled("New pack")).toBeDefined();
    expect(editing()).toBe(false);
  });

  it("goes straight to the editor for a blank draft", async () => {
    await mount(blankPack());
    expect(container.textContent).not.toContain("Which pack?");
    expect(editing()).toBe(true);
  });

  it("goes straight to the editor when nothing was ever saved", async () => {
    await mount(null);
    expect(container.textContent).not.toContain("Which pack?");
    expect(editing()).toBe(true);
  });

  it("sets the tab to Design", async () => {
    await mount(null);
    expect(document.title.startsWith("Design")).toBe(true);
  });

  it("replaces the draft and opens the editor once New pack is confirmed", async () => {
    await mount({ ...blankPack(), title: "Two-Line Days" });
    expect(container.textContent).toContain("Which pack?");

    await act(async () => {
      buttonLabeled("New pack")!.click();
    });

    // The app's own dialog, not the browser's gray box: it names the
    // action and says what replacing the draft costs.
    expect(container.textContent).toContain("Start a new pack?");
    expect(container.textContent).toContain("The draft you have open is replaced.");
    await act(async () => {
      buttonLabeled("Start a new one")!.click();
    });

    expect(container.textContent).not.toContain("Which pack?");
    expect(editing()).toBe(true);
    // Replaced, not merely dismissed: the title is the blank pack's own.
    expect(container.textContent).toContain("My Game");
    expect(saveDraft).toHaveBeenCalled();
  });

  it("leaves the draft alone and opens the editor when Continue is chosen", async () => {
    await mount({ ...blankPack(), title: "Two-Line Days" });

    await act(async () => {
      buttonLabeled("Continue editing Two-Line Days")!.click();
    });

    expect(container.textContent).not.toContain("Which pack?");
    expect(container.textContent).toContain("Two-Line Days");
    expect(editing()).toBe(true);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("cancelling New pack leaves the door open", async () => {
    await mount({ ...blankPack(), title: "Two-Line Days" });

    await act(async () => {
      buttonLabeled("New pack")!.click();
    });
    await act(async () => {
      buttonLabeled("Cancel")!.click();
    });

    expect(container.textContent).toContain("Which pack?");
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("keeps the three draft-lifecycle actions together in the header, New pack first", async () => {
    await mount(blankPack());
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".menuButton")!.click();
    });
    const labels = Array.from(container.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent);
    expect(labels).toEqual(["New pack", "Open a file…", "Start from a pack…"]);
  });

  it("hands the pack over from Publish, not from the header", async () => {
    await mount(blankPack());
    expect(container.textContent).not.toContain("Download");
    await act(async () => {
      sectionItem(container, "Publish").click();
    });
    expect(container.textContent).toContain("Download");
    expect(buttonLabeled("Copy a link")).toBeDefined();
  });
});

/** One of the six names in the section navigation. */
function sectionItem(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>(".designNavItem")).find((b) =>
    (b.textContent ?? "").startsWith(label),
  );
  if (!found) throw new Error(`no section named ${label}`);
  return found;
}

/**
 * Six sections, freely navigable.
 *
 * The editor was one long page, so a table and the license were the same
 * distance away: the bottom. These cover what the sections have to keep
 * true of the one draft underneath them, which is everything: nothing is
 * re-parsed on the way between them and nothing is dropped.
 */
describe("the editor in six sections", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    history.replaceState(null, "", "/");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(saveDraft).mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    history.replaceState(null, "", "/");
    vi.mocked(loadDraft).mockReset();
    vi.mocked(saveDraft).mockReset();
  });

  async function mount(stored: Draft, onTest?: (pack: { title: string }) => void) {
    vi.mocked(loadDraft).mockResolvedValue({ id: "current", pack: stored, updatedAt: "2026-01-01T00:00:00Z" });
    await act(async () => {
      root.render(<DesignView onTest={onTest as never} />);
    });
    // A draft that is not the blank one is asked about first; these are
    // about the editor behind that door, so it is walked through.
    const door = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Continue editing"));
    if (door) {
      await act(async () => {
        door.click();
      });
    }
  }

  const buttonLabeled = (text: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text);
  const fieldNamed = (label: string) =>
    Array.from(container.querySelectorAll<HTMLElement>(".field")).find((f) => f.querySelector(".fieldLabel")?.textContent === label);
  const typeIn = async (label: string, value: string) => {
    const input = fieldNamed(label)!.querySelector<HTMLInputElement>("input, textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

  it("shows the six sections, each with what it owes", async () => {
    // An empty title is an error the schema reports at `title`, which
    // Overview owns; a table with no entries is one Tables owns.
    await mount({ ...blankPack(), title: "", tables: { prompt: { resolution: "lookup", title: "P", roll: "d6", entries: [] } } });
    const items = Array.from(container.querySelectorAll(".designNavItem"));
    expect(items.map((b) => (b.textContent ?? "").replace(/\d+$/, ""))).toEqual(["Overview", "Tables", "Flow", "Modes", "Test", "Publish"]);
    expect(sectionItem(container, "Overview").querySelector(".badge")?.textContent).toBe("1");
    expect(sectionItem(container, "Tables").querySelector(".badge")).not.toBeNull();
    expect(sectionItem(container, "Modes").querySelector(".badge")).toBeNull();
  });

  it("opens on the section the address names, and writes the address when one is pressed", async () => {
    history.replaceState(null, "", "#create/tables");
    await mount(blankPack());
    expect(sectionItem(container, "Tables").getAttribute("aria-current")).toBe("page");
    expect(container.textContent).toContain("what the game rolls at you");

    await act(async () => {
      sectionItem(container, "Flow").click();
    });
    expect(location.hash).toBe("#create/flow");
    expect(container.textContent).toContain("what happens in a turn, in order");

    // Back walks the sections the way it walks pages: the editor follows
    // the address rather than holding its own idea of where it is.
    await act(async () => {
      history.replaceState(null, "", "#create/tables");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(sectionItem(container, "Tables").getAttribute("aria-current")).toBe("page");
  });

  it("spells Overview as the bare address", async () => {
    history.replaceState(null, "", "#create/publish");
    await mount(blankPack());
    await act(async () => {
      sectionItem(container, "Overview").click();
    });
    expect(location.hash).toBe("#create");
  });

  it("takes a row of the report to the field that caused it", async () => {
    await mount({ ...blankPack(), title: "" });
    await act(async () => {
      sectionItem(container, "Test").click();
    });
    const row = Array.from(container.querySelectorAll<HTMLButtonElement>(".problemRow")).find((b) =>
      (b.textContent ?? "").startsWith("title"),
    )!;
    expect(row).toBeDefined();
    await act(async () => {
      row.click();
    });
    await settle();
    expect(sectionItem(container, "Overview").getAttribute("aria-current")).toBe("page");
    expect(document.activeElement).toBe(fieldNamed("Title")!.querySelector("input"));
  });

  it("keeps a draft the schema rejects exactly as it was through every section", async () => {
    // A version that is a number, and a key the editor has no control for:
    // neither is touched by anything, including moving between sections.
    const odd: Draft = { ...blankPack(), version: 7, wobble: { deep: [1, "two"] } };
    await mount(odd);
    await typeIn("Title", "Half typed,");

    for (const label of ["Tables", "Flow", "Modes", "Test", "Publish", "Overview"]) {
      await act(async () => {
        sectionItem(container, label).click();
      });
    }

    const saves = vi.mocked(saveDraft).mock.calls;
    expect(saves).toHaveLength(1);
    expect(saves[0]![0]!.pack).toEqual({ ...odd, title: "Half typed," });
    // And the field still holds what was typed, not a re-read of the draft.
    expect(fieldNamed("Title")!.querySelector("input")!.value).toBe("Half typed,");
  });

  it("says when a save failed, and tries again on request", async () => {
    await mount(blankPack());
    vi.mocked(saveDraft).mockRejectedValueOnce(new Error("no room"));
    await typeIn("Title", "Two-Line Days");
    expect(container.textContent).toContain("Could not save");

    vi.mocked(saveDraft).mockResolvedValue(undefined);
    await act(async () => {
      buttonLabeled("Try again")!.click();
    });
    expect(container.textContent).toContain("Saved");
    expect(container.textContent).not.toContain("Could not save");
  });

  it("asks before a file replaces a draft that is somebody's work, and not before it replaces the blank one", async () => {
    await mount(blankPack());
    await pickFile(container, "title: From A File\nid: com.example.from-a-file\n");
    // A blank draft is nobody's work, so nothing is asked and it is gone.
    expect(container.textContent).not.toContain("Replace");
    expect(container.textContent).toContain("From A File");

    await act(async () => {
      sectionItem(container, "Overview").click();
    });
    await pickFile(container, "title: Second File\nid: com.example.second\n");
    expect(container.textContent).toContain("Replace From A File?");
    expect(container.textContent).toContain("The draft you have open is replaced.");
    await act(async () => {
      buttonLabeled("Cancel")!.click();
    });
    expect(container.textContent).toContain("From A File");
    expect(container.textContent).not.toContain("Second File");
  });

  it("keeps Try it in the header on every section, and gated on a pack that loads", async () => {
    const tried: string[] = [];
    await mount({ ...blankPack(), title: "" }, (pack) => tried.push(pack.title));
    expect(buttonLabeled("Try it")!.disabled).toBe(true);
    await act(async () => {
      sectionItem(container, "Publish").click();
    });
    expect(buttonLabeled("Try it")).toBeDefined();
  });

  it("names every reorder control by what it moves", async () => {
    await mount(blankPack());
    await act(async () => {
      sectionItem(container, "Flow").click();
    });
    const up = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Move up"]'));
    const down = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Move down"]'));
    expect(up).toHaveLength(3);
    expect(down).toHaveLength(3);
    expect(up[0]!.getAttribute("aria-label")).toBe("Move up: Open the Round");
    expect(down.at(-1)!.getAttribute("aria-label")).toBe("Move down: Finish");
  });
});

/**
 * The words in Overview, the numbers and the release in Publish.
 *
 * An id and a version are the first two fields a new author used to be
 * asked for and the two they are least able to answer, and Publish was a
 * pile of panels rather than a list of what is left. These cover where the
 * two fields live now, what says the id is still a placeholder, and that
 * Publish reads top to bottom with each part saying where it stands.
 */
describe("the technical and the distribution details", () => {
  let root: Root;
  let container: HTMLDivElement;

  /** A signature of the shape the schema asks for. Not a real one: nothing here verifies it, the panel only reads it. */
  const SIGNATURE = {
    algorithm: "ecdsa-p256-sha256",
    publicKey: "pub",
    value: "sig",
    signedAt: "2026-03-04T10:00:00.000Z",
    signedBy: "A. Author",
  };

  beforeEach(() => {
    history.replaceState(null, "", "/");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(saveDraft).mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    history.replaceState(null, "", "/");
    vi.mocked(loadDraft).mockReset();
    vi.mocked(saveDraft).mockReset();
  });

  async function mount(stored: Draft) {
    vi.mocked(loadDraft).mockResolvedValue({ id: "current", pack: stored, updatedAt: "2026-01-01T00:00:00Z" });
    await act(async () => {
      root.render(<DesignView />);
    });
    const door = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Continue editing"));
    if (door) {
      await act(async () => {
        door.click();
      });
    }
  }

  const fieldNamed = (label: string) =>
    Array.from(container.querySelectorAll<HTMLElement>(".field")).find((f) => f.querySelector(".fieldLabel")?.textContent === label);
  const labelsIn = (scope: Element) => Array.from(scope.querySelectorAll<HTMLElement>(".field .fieldLabel")).map((l) => l.textContent);
  /** The fold at the end of Overview. */
  const technical = () => container.querySelector<HTMLDetailsElement>(".designBody details")!;
  const headings = () => Array.from(container.querySelectorAll(".designBody .sectionTitle")).map((h) => h.textContent ?? "");
  const show = async (label: string) => {
    await act(async () => {
      sectionItem(container, label).click();
    });
  };
  const typeIn = async (label: string, value: string) => {
    const input = fieldNamed(label)!.querySelector<HTMLInputElement>("input, textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("asks for the words first and folds the numbers away", async () => {
    await mount(blankPack());
    const identity = container.querySelector(".designBody .panel")!;
    expect(labelsIn(identity)).toEqual(["Title", "Description", "Author", "Category", "Tags"]);

    const fold = technical();
    expect(fold.querySelector("summary")!.textContent).toContain("Technical details");
    expect(fold.open).toBe(false);
    expect(labelsIn(fold)).toEqual(["Id", "Version"]);
  });

  it("says a placeholder id is one, in the header, at the field and on Publish", async () => {
    await mount(blankPack());
    const badges = () => Array.from(container.querySelectorAll(".badge")).filter((b) => b.textContent === "Placeholder");
    // One in the header's echo, one beside the field it belongs to.
    expect(badges()).toHaveLength(2);
    expect(fieldNamed("Id")!.closest(".fieldWithBadge")!.querySelector(".badge")!.textContent).toBe("Placeholder");

    await show("Publish");
    expect(container.textContent).toContain(
      "This pack still has a placeholder id. Give it a domain you control before you sign or share it.",
    );

    await show("Overview");
    await typeIn("Id", "io.ferrell.two-line-days");
    expect(badges()).toHaveLength(0);
    await show("Publish");
    expect(container.textContent).not.toContain("still has a placeholder id");
    expect(container.textContent).toContain("io.ferrell.two-line-days");
  });

  it("keeps the badge out of what the Id field is called", async () => {
    // A label names the control it wraps out of everything inside it, so a
    // badge drawn in there would rename the field for anyone listening to
    // it rather than looking at it. The word still has to be in the page.
    await mount(blankPack());
    const idInput = () => fieldNamed("Id")!.querySelector("input")!;
    const withBadge = computeAccessibleName(idInput());
    expect(withBadge.startsWith("Id ")).toBe(true);
    expect(container.querySelector(".fieldWithBadge .badge")!.textContent).toBe("Placeholder");
    expect(withBadge).not.toContain("Placeholder");

    await typeIn("Id", "io.ferrell.two-line-days");
    expect(container.querySelector(".fieldWithBadge")).toBeNull();
    expect(computeAccessibleName(idInput())).toBe(withBadge);
  });

  it("reads Publish top to bottom, each part saying where it stands", async () => {
    await mount(blankPack());
    await show("Publish");
    expect(headings().filter((h) => !h.startsWith("Sign and seal"))).toEqual([
      "Identifier and version",
      "License",
      "Signature",
      "Documents written from the pack",
      "Share",
    ]);
    // Sign and seal is under Signature, not a checklist item of its own.
    expect(headings()[3]).toMatch(/^Sign and seal/);
    expect(container.querySelector(".publishState")!.textContent).toContain("com.example.my-game");
    expect(container.textContent).toContain("Not signed");
  });

  it("names the signer and the day from the draft's own signature", async () => {
    await mount({ ...blankPack(), signature: SIGNATURE });
    await show("Publish");
    const signed = Array.from(container.querySelectorAll(".publishState")).map((p) => p.textContent ?? "");
    expect(signed.some((line) => /^Signed by A\. Author on /.test(line))).toBe(true);
    expect(container.textContent).not.toContain("Not signed");
  });

  it("says the signature is gone the moment an edit takes it, and counts it against Publish", async () => {
    await mount({ ...blankPack(), signature: SIGNATURE });
    expect(sectionItem(container, "Publish").querySelector(".badge")).toBeNull();

    await typeIn("Title", "Two-Line Days");
    expect(sectionItem(container, "Publish").querySelector(".badge")!.textContent).toBe("1");

    await show("Publish");
    expect(container.textContent).toContain("Signature dropped by an edit");
    expect(container.textContent).toContain("Sign the pack again when you are finished");
    expect(container.textContent).not.toContain("Signed by A. Author");
  });

  it("takes Edit in Overview to the id, with the fold open", async () => {
    await mount(blankPack());
    await show("Publish");
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((b) => b.textContent === "Edit in Overview")!
        .click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(sectionItem(container, "Overview").getAttribute("aria-current")).toBe("page");
    expect(technical().open).toBe(true);
    expect(document.activeElement).toBe(fieldNamed("Id")!.querySelector("input"));
  });

  it("reads the rulebook from Test, where the rules are being tried", async () => {
    await mount(blankPack());
    await show("Test");
    const open = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Read the rulebook");
    expect(open()).toBeDefined();
    expect(container.querySelector(".docPreview")).toBeNull();
    await act(async () => {
      open()!.click();
    });
    expect(container.querySelector(".docPreview")).not.toBeNull();
    expect(container.querySelector(".docPreview")!.textContent).toContain("My Game");
  });
});

/** Choose a file in the header's hidden input, the way the file dialog does. */
async function pickFile(container: HTMLElement, text: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new File([text], "pack.yaml", { type: "text/yaml" })], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Trying a draft: a valid one can be played from the Designer without being
 * saved anywhere, and one with errors cannot be played at all. The button
 * is the caller's to offer, since it is the app that holds the bench.
 */
describe("trying a draft from the Designer", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    history.replaceState(null, "", "/");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(saveDraft).mockResolvedValue(undefined);
    vi.mocked(loadDraft).mockResolvedValue(null);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(loadDraft).mockReset();
    vi.mocked(saveDraft).mockReset();
  });

  const buttonLabeled = (text: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text);

  it("hands the parsed pack over when Try it is pressed", async () => {
    const tried: string[] = [];
    await act(async () => {
      root.render(<DesignView onTest={(pack) => tried.push(pack.title)} />);
    });
    const button = buttonLabeled("Try it");
    expect(button).toBeDefined();
    expect(button!.disabled).toBe(false);
    await act(async () => {
      button!.click();
    });
    expect(tried).toEqual([blankPack().title]);
  });

  it("offers nothing to try when the app has no bench", async () => {
    await act(async () => {
      root.render(<DesignView />);
    });
    expect(buttonLabeled("Try it")).toBeUndefined();
  });
});
