// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EndingChoices } from "./EndingChoices.tsx";

afterEach(cleanup);

const endings = [
  { id: "kept", label: "Kept", text: "The piece survives." },
  { id: "cracked", label: "Cracked", text: "It did not." },
];

describe("the ways a run can end", () => {
  it("is a named group with nothing pressed at first", () => {
    render(<EndingChoices endings={endings} chosen={null} onChoose={() => {}} />);
    const group = screen.getByRole("group", { name: "Endings" });
    expect(group.querySelectorAll('button[aria-pressed="false"]')).toHaveLength(2);
  });

  it("marks the chosen card with the pressed state and the ring class", () => {
    render(<EndingChoices endings={endings} chosen="cracked" onChoose={() => {}} />);
    const chosen = screen.getByRole("button", { name: /Cracked/, pressed: true });
    expect(chosen.className).toBe("choice pickOne");
    expect(screen.getByRole("button", { name: /Kept/, pressed: false }).className).toBe("choice pickOne");
  });

  it("draws the remote's buttons as small ghosts with the same state, label only", () => {
    const onChoose = vi.fn();
    render(<EndingChoices endings={endings} chosen="kept" onChoose={onChoose} compact />);
    const kept = screen.getByRole("button", { name: "Kept", pressed: true });
    expect(kept.className).toBe("ghost small pickOne");
    expect(kept.textContent).toBe("Kept");
    fireEvent.click(screen.getByRole("button", { name: "Cracked", pressed: false }));
    expect(onChoose).toHaveBeenCalledWith("cracked");
  });
});
