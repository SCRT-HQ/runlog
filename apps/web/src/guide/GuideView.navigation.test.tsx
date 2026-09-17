// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuideView } from "./GuideView.tsx";

const MOBILE_QUERY = "(max-width: 760px)";
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

function responsiveViewport(startsMobile: boolean) {
  let mobile = startsMobile;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    get matches() {
      return mobile;
    },
    media: MOBILE_QUERY,
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function") listeners.add(listener as (event: MediaQueryListEvent) => void);
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function") listeners.delete(listener as (event: MediaQueryListEvent) => void);
    },
    addListener: (listener: ((event: MediaQueryListEvent) => void) | null) => {
      if (listener) listeners.add(listener);
    },
    removeListener: (listener: ((event: MediaQueryListEvent) => void) | null) => {
      if (listener) listeners.delete(listener);
    },
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query),
  );
  return {
    resizeToMobile(next: boolean, beforeChange?: () => void) {
      mobile = next;
      beforeChange?.();
      const event = { matches: mobile, media: MOBILE_QUERY } as MediaQueryListEvent;
      act(() => listeners.forEach((listener) => listener(event)));
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

describe("Guide contents navigation", () => {
  it("keeps Play and the article outside a mobile disclosure while the complete contents navigation stays inside", async () => {
    responsiveViewport(true);
    const onNavigate = vi.fn();
    render(<GuideView slug="obs" onNavigate={onNavigate} onBack={() => {}} />);

    const summary = screen.getByText("Guide contents");
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(screen.getByRole("button", { name: "Play" }).closest("details")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "OBS Studio and Streamlabs" }).closest("details")).toBeNull();

    details.open = true;
    const contents = within(details);
    const pageLink = contents.getByRole("link", { name: "StreamElements" });
    expect(pageLink.getAttribute("href")).toBe("#guide/streamelements");
    fireEvent.click(pageLink);
    expect(onNavigate).toHaveBeenLastCalledWith("streamelements", undefined);

    const sectionLink = await contents.findByRole("link", { name: "A browser source in OBS Studio" });
    expect(sectionLink.getAttribute("href")).toBe("#guide/obs/a-browser-source-in-obs-studio");
    fireEvent.click(sectionLink);
    expect(onNavigate).toHaveBeenLastCalledWith("obs", "a-browser-source-in-obs-studio");
  });

  it("opens for desktop semantics and keeps focus visible through both breakpoint directions", async () => {
    const viewport = responsiveViewport(false);
    render(<GuideView slug="obs" onNavigate={() => {}} onBack={() => {}} />);

    const summary = screen.getByText("Guide contents");
    const details = summary.closest("details") as HTMLDetailsElement;
    await waitFor(() => expect(details.open).toBe(true));

    const link = within(details).getByRole("link", { name: "StreamElements" });
    link.focus();
    expect(document.activeElement).toBe(link);

    viewport.resizeToMobile(true);
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(link);

    summary.focus();
    viewport.resizeToMobile(false, () => summary.blur());
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(within(details).getByRole("link", { name: "OBS Studio and Streamlabs" }));
  });

  it("falls back to desktop-open semantics when media queries are unavailable", async () => {
    render(<GuideView slug="obs" onNavigate={() => {}} onBack={() => {}} />);
    const details = screen.getByText("Guide contents").closest("details") as HTMLDetailsElement;
    await waitFor(() => expect(details.open).toBe(true));
  });
});
