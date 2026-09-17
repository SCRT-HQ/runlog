import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IncomingPackBanner, type Incoming } from "./IncomingPack.tsx";

describe("a shared signed pack", () => {
  it("marks its fingerprint value as machine-readable code", () => {
    const incoming: Incoming = {
      document: { title: "The Long Kiln" },
      title: "The Long Kiln",
      loads: true,
      signature: {
        status: "valid",
        publicKey: "public-key",
        fingerprint: "9d0a2f",
        signedAt: "2026-09-17T00:00:00Z",
      },
    };

    const html = renderToStaticMarkup(<IncomingPackBanner incoming={incoming} error={null} onOpen={() => {}} onDismiss={() => {}} />);

    expect(html).toContain("Fingerprint <code>9d0a2f</code>");
  });
});
