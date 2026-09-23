// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PersonaChips } from "./PersonaChips.tsx";
import { PERSONAS } from "./personas.ts";

afterEach(cleanup);

describe("whose run the example is", () => {
  it("rings the pressed persona and no other", () => {
    render(<PersonaChips persona={PERSONAS[0]!} onChange={() => {}} />);
    const pressed = screen.getByRole("button", { name: PERSONAS[0]!.noun, pressed: true });
    expect(pressed.className).toBe("personaChip pickOne");
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });
});
