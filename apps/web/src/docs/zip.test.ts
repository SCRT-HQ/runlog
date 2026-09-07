import { describe, expect, it } from "vitest";
import { crc32, unzip, zip } from "./zip.ts";

describe("the archive", () => {
  it("holds its files, byte for byte, with the right checksums and count", () => {
    const sealed = new Uint8Array([0x52, 0x4c, 0x50, 0x41, 0x43, 0x4b, 0, 0, 0, 7, 1, 2, 3]);
    const bytes = zip(
      [
        { name: "my-pack.yaml", data: "id: com.example.pack\ntitle: Pack\n" },
        { name: "docs/rulebook.html", data: "<!doctype html><p>Rules</p>" },
        { name: "my-pack-ada.rlpack", data: sealed },
      ],
      new Date(2026, 8, 7, 12, 30, 0),
    );
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const back = unzip(bytes);
    expect(back.map((e) => e.name)).toEqual(["my-pack.yaml", "docs/rulebook.html", "my-pack-ada.rlpack"]);
    expect(new TextDecoder().decode(back[0]!.data as Uint8Array)).toBe("id: com.example.pack\ntitle: Pack\n");
    expect(Array.from(back[2]!.data as Uint8Array)).toEqual(Array.from(sealed));
    // The end-of-directory record counts the entries.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.length - 22 + 10, true)).toBe(3);
  });

  it("computes the CRC every unzipper checks", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});
