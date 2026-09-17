import { describe, expect, it } from "vitest";
import { License } from "./pack.ts";

describe("the license's word on a table sharing one copy", () => {
  it("defaults to the table playing off one copy", () => {
    const parsed = License.parse({ id: "proprietary", text: "All rights reserved.", redistributable: false });
    expect(parsed.tablePlays).toBe(true);
  });

  it("takes the author's no", () => {
    const parsed = License.parse({ id: "proprietary", text: "All rights reserved.", redistributable: false, tablePlays: false });
    expect(parsed.tablePlays).toBe(false);
  });
});
