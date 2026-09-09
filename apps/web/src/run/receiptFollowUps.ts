import type { RollReceipt } from "./Receipt.tsx";

/**
 * When a settled receipt offers more than "Carry on": drawing again, or
 * having the machine roll from here on. The page's `<Receipt>` and the
 * floating remote both decide this the same way, so it is worked out once
 * here rather than copied between them.
 */
export function receiptFollowUps(
  run: {
    canDrawAgain: boolean;
    autoRoll: boolean;
    seededRun: boolean;
    readOnly: boolean;
    drawAgain: (reason?: string) => void;
    setAutoRoll: (on: boolean) => void;
  },
  settled: boolean,
  lastReceipt: RollReceipt | null,
): { onDrawAgain?: (reason?: string) => void; onKeepRolling?: () => void } {
  return {
    ...(settled && run.canDrawAgain && !run.readOnly ? { onDrawAgain: (why?: string) => run.drawAgain(why) } : {}),
    ...(settled && lastReceipt?.machineRolled && !run.autoRoll && !run.seededRun && !run.readOnly
      ? { onKeepRolling: () => run.setAutoRoll(true) }
      : {}),
  };
}
