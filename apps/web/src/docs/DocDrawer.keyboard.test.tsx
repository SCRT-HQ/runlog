// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StrictMode, act, useRef, useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPackText, type Doc, type DocKind, type Pack } from "@runlog/rules-schema";
import { DocDrawerProvider, useDocDrawer, type DocTab } from "./DocDrawer.tsx";
import { useFocusTrap } from "../ui/useFocusTrap.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("could not load the demo pack");
const kiln: Pack = loaded.pack;

const paper = (kind: DocKind, title: string, text: string): Doc => ({
  kind,
  layout: "book",
  title,
  blocks: [{ kind: "paragraph", text }],
});

const supplied: DocTab[] = [
  { label: "Briefing", what: "The short version.", make: () => paper("summary", "Briefing paper", "First supplied document") },
  { label: "Instructions", what: "What to do.", make: () => paper("rulebook", "Instruction paper", "Second supplied document") },
  { label: "Notes", what: "What to remember.", make: () => paper("quickstart", "Notes paper", "Third supplied document") },
];

function NestedLayer({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useFocusTrap(panel, true, onClose);
  return (
    <section ref={panel} role="alertdialog" aria-label="Nested question" tabIndex={-1}>
      <button>Nested action</button>
    </section>
  );
}

function Controls() {
  const drawer = useDocDrawer();
  const [nested, setNested] = useState(false);
  return (
    <main>
      <button id="supplied-opener" onClick={() => drawer.show("Supplied packet", supplied)}>
        Open supplied documents
      </button>
      <button id="pack-opener" onClick={() => drawer.open(kiln, "quickstart", { section: "packs", id: kiln.id })}>
        Open pack documents
      </button>
      <button onClick={() => setNested(true)}>Open nested layer</button>
      {nested && <NestedLayer onClose={() => setNested(false)} />}
    </main>
  );
}

function Page({ strict = false }: { strict?: boolean }) {
  const content: ReactNode = (
    <DocDrawerProvider>
      <Controls />
    </DocDrawerProvider>
  );
  return strict ? <StrictMode>{content}</StrictMode> : content;
}

const press = (key: string, shiftKey = false) =>
  act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })));

const click = (element: HTMLElement) => act(async () => void fireEvent.click(element));

const open = async (which: "supplied" | "pack" = "supplied", strict = false) => {
  render(<Page strict={strict} />);
  const opener = screen.getByRole("button", { name: which === "supplied" ? "Open supplied documents" : "Open pack documents" });
  opener.focus();
  await click(opener);
  return opener;
};

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

describe("the document drawer as a keyboard sees it", () => {
  it("opens supplied documents on Close and isolates the page behind it", async () => {
    await open();

    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close" }));
    expect(document.getElementById("supplied-opener")?.closest("[inert]")).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");

    for (let i = 0; i < 6; i++) {
      await press("Tab", i % 2 === 1);
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("opens a pack on the requested document with Close focused", async () => {
    await open("pack");

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("tab", { name: "Quick start" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toContain("Quick start");
  });

  it("keeps addressed pack documents on their existing route spellings as a tab changes", async () => {
    await open("pack");
    expect(location.hash).toBe(`#packs/${encodeURIComponent(kiln.id)}/docs/quickstart`);

    fireEvent.keyDown(screen.getByRole("tab", { name: "Quick start" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Reference card" }).getAttribute("aria-selected")).toBe("true");
    expect(location.hash).toBe(`#packs/${encodeURIComponent(kiln.id)}/docs/reference`);
  });

  it.each([
    ["Escape", async () => press("Escape")],
    ["Close", async () => click(screen.getByRole("button", { name: "Close" }))],
    ["the backdrop", async () => click(screen.getByRole("dialog").parentElement as HTMLElement)],
  ])("releases isolation and restores the opener after %s", async (_way, dismiss) => {
    const opener = await open();
    await dismiss();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(opener.closest("[inert]")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("restores its connected opener when StrictMode mounts effects twice", async () => {
    const opener = await open("supplied", true);
    await press("Escape");
    expect(document.activeElement).toBe(opener);
  });

  it("lets a nested shared layer consume Escape before the drawer", async () => {
    await open();
    await click(screen.getByRole("button", { name: "Open nested layer" }));

    await press("Escape");
    expect(screen.queryByRole("alertdialog", { name: "Nested question" })).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();

    await press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the document-kind strip", () => {
  it("names one tab stop and connects every supplied tab to the displayed panel", async () => {
    await open();

    const strip = screen.getByRole("tablist", { name: "Documents" });
    const tabs = within(strip).getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(new Set(tabs.map((tab) => tab.id)).size).toBe(3);
    expect(new Set(tabs.map((tab) => tab.getAttribute("aria-controls"))).size).toBe(3);

    const panel = screen.getByRole("tabpanel");
    expect(panel.tabIndex).toBe(0);
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0]?.id);
    expect(tabs[0]?.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.textContent).toContain("First supplied document");

    await click(tabs[1] as HTMLElement);
    const selected = screen.getByRole("tab", { name: "Instructions" });
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toContain("Second supplied document");
    expect(selected.className).toBe("chip pick pickTab");
    expect(tabs.some((t) => t.classList.contains("on"))).toBe(false);
  });

  it("automatically selects and focuses tabs with arrows, Home, and End", async () => {
    await open();
    const named = (name: string) => screen.getByRole("tab", { name });

    named("Briefing").focus();
    fireEvent.keyDown(named("Briefing"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(named("Notes"));
    expect(named("Notes").getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(named("Notes"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(named("Briefing"));
    expect(screen.getByRole("tabpanel").textContent).toContain("First supplied document");

    fireEvent.keyDown(named("Briefing"), { key: "End" });
    expect(document.activeElement).toBe(named("Notes"));
    fireEvent.keyDown(named("Notes"), { key: "Home" });
    expect(document.activeElement).toBe(named("Briefing"));

    await press("Tab");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Print" }));
  });
});
