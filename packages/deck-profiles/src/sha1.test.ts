import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { sha1, utf8 } from "./sha1.ts";

/**
 * The hand-written digest, held against the one Node ships.
 *
 * It is here because a browser cannot call `node:crypto` and
 * `crypto.subtle` is async, not because anything was wrong with Node's. So
 * the test that matters is that the two agree, on the short strings the
 * ids are made of and on lengths either side of a block boundary, where a
 * padding mistake hides.
 */
describe("sha1", () => {
  const node = (bytes: Uint8Array) => new Uint8Array(createHash("sha1").update(bytes).digest());

  it("agrees with node:crypto on the strings the ids are made of", () => {
    for (const text of ["", "com.scrthq.runlog.profiles", "demo/xl", "elden-ring/plus/page/2/key/11", "The Long Kiln"]) {
      expect([...sha1(utf8(text))], text).toEqual([...node(utf8(text))]);
    }
  });

  it("pads right either side of a block", () => {
    // 55 and 56 bytes are where the length no longer fits in the first
    // block and a second one has to be added; 64 and 119 are the same
    // edge one block along.
    for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const bytes = new Uint8Array(randomBytes(length));
      expect([...sha1(bytes)], `${length} bytes`).toEqual([...node(bytes)]);
    }
  });
});
