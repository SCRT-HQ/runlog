// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { loadMarketplace, shippedIds } from "../library/marketplace.ts";
import { WelcomeView } from "./WelcomeView.tsx";
import { PERSONAS } from "./personas.ts";

/**
 * The landing page says one thing, and stays short.
 *
 * The page it replaced grew a section at a time until nothing on it was
 * the first thing a reader saw. The word count here is the guard against
 * that happening again: the four sections between the headline and the
 * pack shelf are a budget, and a new paragraph has to displace an old one
 * rather than sit beside it.
 */

afterEach(cleanup);
// The page remembers the persona on the device, so one test's chip would be
// the next test's opening example.
beforeEach(() => localStorage.clear());

/** The words of the four sections between the hero and the pack shelf. */
function bodyWords(root: HTMLElement): number {
  return [...root.querySelectorAll(".welcomeSection")]
    .map((s) => s.textContent ?? "")
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
}

describe("the welcome page", () => {
  it("says what Runlog is once, and says it the same way every time", () => {
    const { container } = render(<WelcomeView />);
    const text = container.textContent ?? "";
    expect(text.split("Runlog is a constraint engine.")).toHaveLength(2);
    expect(text.split("Runlog controls the rules. You control the outcome.")).toHaveLength(2);
    // Nothing in the headline turns with the persona.
    expect(container.querySelector("h2")?.textContent).toBe("Runlog is a constraint engine.");
  });

  it("keeps the body between the headline and the packs under 320 words", () => {
    const { container } = render(<WelcomeView />);
    expect(container.querySelectorAll(".welcomeSection")).toHaveLength(4);
    expect(bodyWords(container)).toBeLessThan(320);
  });

  it("offers one button to play, and one way to the packs, in the hero", () => {
    const { container } = render(<WelcomeView />);
    const hero = container.querySelector(".welcomeHero");
    if (!hero) throw new Error("no hero");
    const labels = [...hero.querySelectorAll("a")].map((a) => a.textContent);
    expect(labels).toContain("Play");
    expect(labels).toContain("See the packs");
    expect(labels).not.toContain("Read the guide");
  });

  it("swaps the log when a persona chip is pressed", () => {
    const { container } = render(<WelcomeView />);
    const other = PERSONAS[3]!;
    const chip = screen.getByRole("button", { name: other.noun });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    const specimen = container.querySelector(".welcomeHero .specimen");
    expect(specimen?.textContent).toContain(other.packTitle);
    expect(specimen?.textContent).toContain(other.log[0]!.text);
  });

  it("swaps the excerpt with the chip too, so the page is about one person all the way down", () => {
    const { container } = render(<WelcomeView />);
    const other = PERSONAS[3]!;
    fireEvent.click(screen.getByRole("button", { name: other.noun }));
    const excerpt = container.querySelector(".welcomeExcerpt");
    expect(excerpt?.textContent).toContain(other.log.at(-1)!.text);
    expect(excerpt?.textContent).not.toContain(PERSONAS[0]!.log.at(-1)!.text);
  });

  it("shows the end of the log, the line that reaches back among it, not the top the hero already shows", () => {
    const { container } = render(<WelcomeView />);
    const lines = [...container.querySelectorAll(".welcomeExcerpt .specimenLog li")];
    expect(lines).toHaveLength(3);
    // The result that reaches back is what the section is about, so it has
    // to be in the excerpt, styled as the specimen styles it.
    expect(lines.filter((li) => li.className === "heat")).toHaveLength(1);
    const first = PERSONAS[0]!;
    expect(lines.at(-1)?.textContent).toContain(first.log.at(-1)!.text);
    expect(lines.map((li) => li.textContent ?? "").join(" ")).not.toContain(first.log[0]!.text);
  });

  it("gives each pack a card of its title and its first sentence, and no more", async () => {
    const { container } = render(<WelcomeView />);
    // Wait for the real lazy pack source, not the default one-second DOM-query
    // deadline: instrumented CI can take longer to import and parse the YAML.
    await act(async () => {
      await Promise.all([loadMarketplace({ testing: false }), shippedIds()]);
    });
    expect(screen.getByText("A penalty wheel for any stream.")).toBeTruthy();
    expect(container.querySelectorAll(".welcomePack")).toHaveLength(9);
    expect(container.textContent).not.toContain("Every round spins what it is worth");
  });

  it("leaves the eight reasons, the second stream list and the closing line behind", () => {
    const { container } = render(<WelcomeView />);
    const text = container.textContent ?? "";
    for (const gone of ["Why Runlog", "Paper included", "Sell it your way", "Dice you can read", "A table with company", "What it costs"])
      expect(text).not.toContain(gone);
  });
});
