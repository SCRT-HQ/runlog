import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { AccountProvider } from "./auth/Account.tsx";
import { HostedProvider } from "./hosted/HostedProvider.tsx";
import { DocDrawerProvider } from "./docs/DocDrawer.tsx";
import { ToastProvider } from "./ui/ToastProvider.tsx";
import { SyncProvider } from "./sync/SyncProvider.tsx";
import { PlanProvider } from "./sync/PlanProvider.tsx";
import { applyBootAppearance, isThemeRecoveryAddress, readBootAppearance } from "./theme/appearance.ts";
import { ThemeProvider } from "./theme/ThemeProvider.tsx";
import { publishesLookAt } from "./theme/follow/LookChannelProvider.tsx";
import { WelcomeView } from "./welcome/WelcomeView.tsx";
import { WELCOME_QUERY, honestAddress, skipWelcome, whereTo } from "./welcome/route.ts";
import { applyWidgetLook, widgetLook } from "./widget/look.ts";
import { bootFollowedLook } from "./widget/channel.ts";
import { widgetFromHash } from "./widget/route.ts";
import { addressOf, appBase, hrefFor, PATHS_ON } from "./route.ts";
import "./fonts.css";
import "./styles.css";

// The bare address is the welcome page, the page that says what Runlog is;
// the app lives under `play`. Anyone who arrived with somewhere to go, or
// who chose to skip the page, is in the app, and the address is made to say
// so. Decided before anything is painted; see welcome/route.ts.
const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const here = {
  protocol: location.protocol,
  pathname: location.pathname,
  base: appBase(location.href),
  hash: location.hash,
  search: location.search,
};
const page = whereTo({ ...here, skip: skipWelcome(storage) });
if (page === "app") {
  const honest = honestAddress(here);
  if (honest) history.replaceState(null, "", honest);
  // An address in the old spelling, a hash, is rewritten as the path it
  // names where paths are on, so a bookmark or a link in a message keeps
  // working and the bar reads the new way.
  if (PATHS_ON && location.hash) {
    const path = hrefFor(location.hash);
    if (path !== location.hash) history.replaceState(null, "", path);
  }
} else if (here.search === WELCOME_QUERY) {
  // Asked for by name: the bare address is what the page is, so that is
  // what the bar reads.
  history.replaceState(null, "", here.base);
}

// Before anything is painted. The policy at the edge forbids inline scripts,
// so this is the earliest the saved choice can reach the document; the root
// is still empty, so nothing has been drawn in the wrong light yet. A widget
// address may pin a theme of its own, and a capture must never show a frame
// in the machine's light first. A widget's look is decided in widget/look.ts:
// its pin, a legacy theme, a theme link's look, a fixed fallback for a pin
// or link with nothing to show, or this device's own choice.
const initialWidget = widgetFromHash(addressOf(location));
const initialAddress = addressOf(location);
if (initialWidget) {
  // A theme link's cached look, before the first paint; the page reads the server once it mounts.
  // A pin or a named built-in wins over a link, so then the link's cache is not read.
  const ch = initialWidget.pin === undefined && !initialWidget.theme ? initialWidget.ch : undefined;
  const followed = ch === undefined ? undefined : bootFollowedLook(ch, storage);
  applyWidgetLook(widgetLook(initialWidget, readBootAppearance(storage), followed), document.documentElement);
} else {
  const initialAppearance = isThemeRecoveryAddress(initialAddress)
    ? ({ schemaVersion: 1, mode: "system" } as const)
    : readBootAppearance(storage);
  applyBootAppearance(initialAppearance, document.documentElement, "app");
}

if (page === "welcome") {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <HostedProvider>
          <WelcomeView />
        </HostedProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
} else
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <HostedProvider>
          <AccountProvider>
            <PlanProvider>
              {/* A widget or a dock, pop-outs included, never publishes this device's look. */}
              <ThemeProvider publishLook={publishesLookAt(initialAddress)}>
                <SyncProvider>
                  <DocDrawerProvider>
                    <ToastProvider>
                      <App />
                    </ToastProvider>
                  </DocDrawerProvider>
                </SyncProvider>
              </ThemeProvider>
            </PlanProvider>
          </AccountProvider>
        </HostedProvider>
      </ErrorBoundary>
    </StrictMode>,
  );

/**
 * Go offline.
 *
 * Guarded on the protocol as well as on support, because one supported way to
 * run this is opening the built file from disk, and a worker cannot be registered
 * from `file://`, attempting it throws rather than failing quietly. It is
 * also skipped in dev, where a cached bundle would fight hot reload.
 *
 * The worker is generated by the build; see apps/web/offline.ts.
 */
if (import.meta.env.PROD && "serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    // Losing offline support is survivable, and there is nothing useful to
    // tell the player about it, so a failure stays in the console.
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
  });
}
