import { describe, expect, it } from "vitest";
import { Action } from "./actions.ts";

describe("rollOn per", () => {
  it("defaults to table", () => {
    const a = Action.parse({ do: "rollOn", table: "loot" });
    expect(a).toMatchObject({ per: "table" });
  });

  it("accepts contestant", () => {
    const a = Action.parse({ do: "rollOn", table: "loot", per: "contestant" });
    expect(a).toMatchObject({ per: "contestant" });
  });

  it("refuses a value outside the enum, naming the field", () => {
    const result = Action.safeParse({ do: "rollOn", table: "loot", per: "nonsense" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "per");
      expect(issue).toBeDefined();
    }
  });
});
