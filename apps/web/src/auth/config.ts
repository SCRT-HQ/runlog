import { appBase } from "../route.ts";
/**
 * Whether there is anything to sign into.
 *
 * Runlog needs no account. Everything is local, and a built copy opened from
 * disk works with nobody's permission — so does the hosted one. What an
 * account adds is a way to know who a run belongs to, which is what anything
 * that outlives one machine will need.
 *
 * Sign-in is WorkOS AuthKit, and the only thing a build needs to know is
 * which client it is. A deploy that builds the app sets that at build time.
 * A deploy that takes a published build, which was built with none, says it
 * in the shell instead: a `runlog:sign-in` meta tag the hosted overlay
 * writes beside the other tags (see hosted/scripts/overlay.ts), so anyone
 * can run the app from the npm package at their own address with their own
 * sign-in and never build it. Absent means there is nothing to offer, which
 * is what local development, the test-suite, a file on disk and a public
 * page all want — and it is read on demand rather than at import so a test
 * can configure one without rebuilding the world.
 */
export function configuredClientId(): string | undefined {
  const id = import.meta.env.VITE_WORKOS_CLIENT_ID;
  if (id) return id;
  if (typeof document === "undefined") return undefined;
  const content = document.querySelector('meta[name="runlog:sign-in"]')?.getAttribute("content");
  return content && /^client_[A-Za-z0-9]+$/.test(content) ? content : undefined;
}

/**
 * Where AuthKit sends people back to, and where sign-out lands.
 *
 * The app has no routes, so the callback is the app itself. Resolved from the
 * document rather than fixed, because the same build is served from the root
 * of two hostnames and from disk — but always with the trailing slash, so it
 * matches the dashboard exactly whether someone arrived at `/` or at
 * `/index.html`.
 */
export function appUrl(): string {
  return new URL(appBase(window.location.href), window.location.href).href;
}
