// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Menu, MenuGroup, MenuItem, MenuRule } from "./Menu.tsx";

/**
 * The menu, from the keyboard.
 *
 * What is checked is the part a mouse hides: that the button says what it
 * opens, that opening lands on the first line, that the arrows walk and
 * wrap, that Escape gives focus back rather than dropping it on the page,
 * and that a press outside closes without stealing it.
 */

const pressed: string[] = [];

const menu = () =>
  render(
    <>
      <button>before</button>
      <Menu label="More">
        {(close) => (
          <>
            <MenuGroup label="Documents">
              <MenuItem
                onSelect={() => {
                  pressed.push("Summary");
                  close();
                }}
              >
                Summary
              </MenuItem>
              <MenuItem onSelect={() => pressed.push("Rulebook")}>Rulebook</MenuItem>
            </MenuGroup>
            <MenuItem disabled onSelect={() => pressed.push("never")}>
              Not now
            </MenuItem>
            <MenuRule />
            <MenuItem tone="danger" onSelect={() => pressed.push("Forget pack")}>
              Forget pack
            </MenuItem>
          </>
        )}
      </Menu>
    </>,
  );

afterEach(() => {
  cleanup();
  pressed.length = 0;
});

const opener = () => screen.getByRole("button", { name: /More/ });

describe("a menu", () => {
  it("says what it opens, and opens on the first line", () => {
    menu();
    expect(opener().getAttribute("aria-haspopup")).toBe("menu");
    expect(opener().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(opener());
    expect(opener().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Summary");
    expect(screen.getAllByRole("menuitem").length).toBe(4);
  });

  it("walks the lines with the arrows, wrapping, and skips a line that cannot be pressed", () => {
    menu();
    fireEvent.click(opener());
    const on = () => document.activeElement!;
    fireEvent.keyDown(on(), { key: "ArrowDown" });
    expect(on().textContent).toBe("Rulebook");
    // "Not now" is disabled; the walk goes past it.
    fireEvent.keyDown(on(), { key: "ArrowDown" });
    expect(on().textContent).toBe("Forget pack");
    fireEvent.keyDown(on(), { key: "ArrowDown" });
    expect(on().textContent).toBe("Summary");
    fireEvent.keyDown(on(), { key: "ArrowUp" });
    expect(on().textContent).toBe("Forget pack");
    fireEvent.keyDown(on(), { key: "Home" });
    expect(on().textContent).toBe("Summary");
    fireEvent.keyDown(on(), { key: "End" });
    expect(on().textContent).toBe("Forget pack");
  });

  it("closes on Escape and hands focus back to the button", () => {
    menu();
    fireEvent.click(opener());
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it("closes on Tab, and leaves from the button rather than from a line that has gone", () => {
    menu();
    fireEvent.click(opener());
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    // The browser's own Tab then moves on from here; what matters is that
    // it moves on from somewhere, and not from the top of the document.
    expect(document.activeElement).toBe(opener());
  });

  it("closes on a press outside, and leaves the focus where the press put it", () => {
    menu();
    fireEvent.click(opener());
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).not.toBe(opener());
  });

  it("does what a line says, and closes when the line asks it to", () => {
    menu();
    fireEvent.click(opener());
    fireEvent.click(screen.getByRole("menuitem", { name: "Rulebook" }));
    expect(pressed).toEqual(["Rulebook"]);
    // Rulebook does not close it; Summary does.
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Summary" }));
    expect(pressed).toEqual(["Rulebook", "Summary"]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it("marks the destructive line, and keeps it behind a rule", () => {
    menu();
    fireEvent.click(opener());
    const forget = screen.getByRole("menuitem", { name: "Forget pack" });
    expect(forget.className).toContain("danger");
    expect(screen.getByRole("separator")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Documents" })).toBeTruthy();
  });
});
