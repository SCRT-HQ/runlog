// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.doUnmock("./three/Dice3D.tsx");
  vi.resetModules();
});

describe("the optional 3D dice setting", () => {
  it("uses the flat tray when this device has switched 3D dice off", async () => {
    localStorage.setItem("runlog:dice3d", "off");
    const { dice3dEnabled } = await import("./settings.ts");

    expect(dice3dEnabled()).toBe(false);
  });

  it("uses the flat tray when the browser cannot provide WebGL", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { canDraw3d, dice3dEnabled } = await import("./settings.ts");

    expect(canDraw3d()).toBe(false);
    expect(dice3dEnabled()).toBe(false);
  });

  it("turns a failed optional 3D chunk into the flat-tray loader result", async () => {
    vi.doMock("./three/Dice3D.tsx", () => {
      throw new Error("chunk unavailable");
    });
    const { loadDice3d } = await import("./settings.ts");

    await expect(loadDice3d()).resolves.toBeNull();
  });
});
