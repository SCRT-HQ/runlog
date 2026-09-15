// jsdom, not the default node environment: this exercises real DOM lookups
// (closest, querySelector, focus) that renderToStaticMarkup cannot give us.
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { nudgeFirstUnticked, nudgeOwed } from "./nudge.ts";

/**
 * The button that finishes a step is never dimmed while a box is unticked;
 * pressing it instead finds the box and focuses it. This works the same way
 * in the page's own document and the floating remote's, since both mark the
 * step's container `.runStep` and neither is known to this function.
 */
describe("nudgeFirstUnticked", () => {
  // jsdom does not implement scrollIntoView; the function calling it is what
  // is under test here, not the scrolling itself.
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

  function step(boxesChecked: boolean[]): { root: HTMLElement; button: HTMLButtonElement } {
    document.body.innerHTML = `
      <section class="runStep">
        ${boxesChecked.map((c) => `<input type="checkbox" ${c ? "checked" : ""} />`).join("\n")}
        <button>Done</button>
      </section>
    `;
    const root = document.querySelector<HTMLElement>(".runStep")!;
    const button = root.querySelector<HTMLButtonElement>("button")!;
    return { root, button };
  }

  it("focuses the first unticked box in this step", () => {
    const { button } = step([true, false, false]);
    nudgeFirstUnticked(button);
    const boxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(document.activeElement).toBe(boxes[1]);
  });

  it("does nothing when every box is already ticked", () => {
    const { button } = step([true, true]);
    expect(() => nudgeFirstUnticked(button)).not.toThrow();
    expect(document.activeElement).not.toBe(document.querySelector("input"));
  });

  it("looks only inside the nearest .runStep, not the whole document", () => {
    document.body.innerHTML = `
      <input type="checkbox" />
      <section class="runStep"><button>Done</button></section>
    `;
    const button = document.querySelector<HTMLButtonElement>(".runStep button")!;
    nudgeFirstUnticked(button);
    // The only unticked box is outside this step, so nothing is focused.
    expect(document.activeElement).not.toBe(document.querySelector("input"));
  });
});

/**
 * Task 25: the closing button is held by what the game is owed as well as
 * by what the player owes, and pressing it has to reach either panel. The
 * page draws "The game has your number" above the obligations, so the one
 * it reaches first is the one it takes.
 */
describe("nudgeOwed", () => {
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

  const page = (panels: string) => {
    document.body.innerHTML = `
      <div class="main">
        <section class="panel runStep finalize"><button id="close">Settle what is owed first</button></section>
        ${panels}
      </div>
    `;
    return document.querySelector<HTMLButtonElement>("#close")!;
  };

  it("takes the player to what the game is owed", () => {
    const close = page(`<section class="panel threshold"><button class="primary" id="fire">Roll d100</button></section>`);
    nudgeOwed(close);
    expect(document.activeElement).toBe(document.querySelector("#fire"));
  });

  it("takes the thresholds panel over the obligations below it", () => {
    const close = page(`
      <section class="panel threshold"><button class="primary" id="fire">Roll d100</button></section>
      <section class="panel owed"><button class="primary" id="settle">Apply it</button></section>
    `);
    nudgeOwed(close);
    expect(document.activeElement).toBe(document.querySelector("#fire"));
  });

  it("still takes the obligations where that is all there is", () => {
    const close = page(`<section class="panel owed"><button class="primary" id="settle">Apply it</button></section>`);
    nudgeOwed(close);
    expect(document.activeElement).toBe(document.querySelector("#settle"));
  });

  it("does nothing where neither panel is on the page", () => {
    const close = page("");
    expect(() => nudgeOwed(close)).not.toThrow();
  });
});
