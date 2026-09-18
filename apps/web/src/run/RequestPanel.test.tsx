// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Pack } from "@runlog/rules-schema";
import type { InputRequest, RunState } from "@runlog/engine";
import { RequestPanel } from "./RequestPanel.tsx";

/**
 * A deck's roll press, arriving as a nonce.
 *
 * The press is the button, not the answer: the panel throws the dice the
 * way "Roll for me" throws them, and the engine hears nothing until they
 * have landed and been read. The flat tray's own timers carry the flight
 * here, so the waiting is wound forward rather than waited out.
 */

const pack = {
  vocabulary: {
    unit: { one: "Stage", many: "Stages" },
    subject: { one: "Piece", many: "Pieces" },
    run: { one: "Firing", many: "Firings" },
  },
  tables: {},
} as unknown as Pack;

const state = { unit: 1, subjects: [], outcomes: [] } as unknown as RunState;

const request: InputRequest = { kind: "roll", key: "u1:check#0", dice: "d6", label: "Roll the Kiln Check", purpose: "check" };

/** The tray's flight for one die, and the beat the number is read for after it. */
const FLIGHT_MS = 620 + 90;
const READ_MS = 700;

function renderPanel(machineRoll: number | undefined, onAnswer = vi.fn()) {
  const view = render(
    <RequestPanel request={request} pack={pack} state={state} onAnswer={onAnswer} onCancel={() => {}} machineRoll={machineRoll} />,
  );
  return {
    onAnswer,
    rerender: (n: number) =>
      view.rerender(<RequestPanel request={request} pack={pack} state={state} onAnswer={onAnswer} onCancel={() => {}} machineRoll={n} />),
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a roll asked for from outside", () => {
  it("throws the dice on the page and answers only once they have landed", async () => {
    vi.useFakeTimers();
    const { onAnswer, rerender } = renderPanel(0);
    expect(document.querySelector(".tray")).toBeNull();

    act(() => rerender(1));
    // The dice are in the air: the tray is up, the total is held back, and
    // the button says as much.
    expect(document.querySelector(".tray")).toBeTruthy();
    expect(screen.getByText("Rolling…")).toBeTruthy();
    expect(onAnswer).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(FLIGHT_MS));
    // Landed and shown, but not yet reported.
    expect(onAnswer).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(READ_MS));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    const [key, total, machineRolled, dice] = onAnswer.mock.calls[0]!;
    expect(key).toBe("u1:check#0");
    expect(total).toBeGreaterThanOrEqual(1);
    expect(total).toBeLessThanOrEqual(6);
    expect(machineRolled).toBe(true);
    expect(dice).toHaveLength(1);
  });

  it("ignores a second press while the throw is still going", async () => {
    vi.useFakeTimers();
    const { onAnswer, rerender } = renderPanel(0);

    act(() => rerender(1));
    await act(() => vi.advanceTimersByTimeAsync(FLIGHT_MS));
    const landed = document.querySelector(".rollTotal .big")!.textContent;
    expect(landed).not.toBe("…");

    // A press that arrives while the dice are down but unreported is not a
    // second throw: the number that landed stands and goes in as it is.
    act(() => rerender(2));
    expect(document.querySelector(".rollTotal .big")!.textContent).toBe(landed);

    await act(() => vi.advanceTimersByTimeAsync(READ_MS));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0]![1]).toBe(Number(landed));
  });

  it("stays where it is until something presses it", () => {
    vi.useFakeTimers();
    const { onAnswer } = renderPanel(undefined);
    expect(document.querySelector(".tray")).toBeNull();
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

describe("the shared cancel action", () => {
  it.each<InputRequest>([
    request,
    { kind: "ask", key: "u1:ask#0", question: "Did the piece survive?" },
    { kind: "prompt", key: "u1:prompt#0", promptKind: "text", label: "Name the result" },
    { kind: "chooseTarget", key: "u1:target#0", label: "Choose a piece", eligible: [] },
  ])("exposes request-scoped spacing for a $kind request", (inputRequest) => {
    render(<RequestPanel request={inputRequest} pack={pack} state={state} onAnswer={() => {}} onCancel={() => {}} />);

    expect(screen.getByRole("button", { name: "Cancel this step" }).classList.contains("requestCancel")).toBe(true);
  });
});
