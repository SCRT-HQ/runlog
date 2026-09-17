// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Doc } from "@runlog/rules-schema";
import App from "../App.tsx";
import { DocDrawerProvider, useDocDrawer, type DocTab } from "./DocDrawer.tsx";

const LADDER = "com.scrthq.runlog.ladder-work";
const PRACTICE = "com.scrthq.runlog.practice-room";

const paper: Doc = {
  kind: "summary",
  layout: "book",
  title: "Supplied briefing",
  blocks: [{ kind: "paragraph", text: "This paper has no route of its own." }],
};
const supplied: DocTab[] = [{ label: "Briefing", make: () => paper }];

function SuppliedDocument() {
  const drawer = useDocDrawer();
  return <button onClick={() => drawer.show("Supplied packet", supplied)}>Open supplied document</button>;
}

async function follow(address: string, event: "popstate" | "hashchange" = "popstate") {
  await act(async () => {
    history.replaceState(null, "", address);
    window.dispatchEvent(event === "popstate" ? new PopStateEvent(event) : new HashChangeEvent(event));
  });
}

async function openAppAt(address: string) {
  history.replaceState(null, "", address);
  render(
    <DocDrawerProvider>
      <App />
    </DocDrawerProvider>,
  );
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(document.body.style.overflow).toBe("hidden"));
  return dialog;
}

beforeEach(() => {
  Object.defineProperty(window, "scrollTo", { configurable: true, value: () => {} });
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

describe("document routes and the drawer", () => {
  it("dismisses an addressed document on Back without rewriting the destination, then lets App reopen it on Forward", async () => {
    await openAppAt(`#marketplace/${LADDER}/docs`);
    expect(document.body.style.overflow).toBe("hidden");

    await follow("#marketplace");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(location.hash).toBe("#marketplace");
    expect(document.body.style.overflow).toBe("");
    expect(document.querySelector("[inert]")).toBeNull();

    await follow(`#marketplace/${LADDER}/docs`);

    const reopened = await screen.findByRole("dialog");
    expect(within(reopened).getByRole("tab", { name: "Summary" }).getAttribute("aria-selected")).toBe("true");
    expect(location.hash).toBe(`#marketplace/${LADDER}/docs`);
  });

  it("loads the kind and pack named by later document route events", async () => {
    await openAppAt(`#marketplace/${LADDER}/docs`);

    await follow(`#marketplace/${LADDER}/docs/rulebook`, "hashchange");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Rulebook" }).getAttribute("aria-selected")).toBe("true"));

    await follow(`#marketplace/${PRACTICE}/docs/quickstart`);
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("Practice Room"));
    expect(screen.getByRole("tab", { name: "Quick start" }).getAttribute("aria-selected")).toBe("true");
    expect(location.hash).toBe(`#marketplace/${PRACTICE}/docs/quickstart`);
  });

  it("does not assign route identity to a supplied document", async () => {
    history.replaceState(null, "", "#guide/start");
    render(
      <DocDrawerProvider>
        <SuppliedDocument />
      </DocDrawerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open supplied document" }));

    await follow("#packs");

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("This paper has no route of its own.")).toBeTruthy();
    expect(location.hash).toBe("#packs");
  });
});
