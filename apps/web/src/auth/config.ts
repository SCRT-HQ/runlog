/**
 * Whether there is anything to sign into.
 *
 * Runlog needs no account. Everything is local, and a built copy opened from
 * disk works with nobody's permission — so does the hosted one. What an
 * account adds is a way to know who a run belongs to, which is what anything
 * that outlives one machine will need.
 *
 * Sign-in is WorkOS AuthKit, and the only thing a build needs to know is
 * which client it is. The deploy sets that; nothing else does. Absent means
 * there is nothing to offer, which is what local development, the test-suite,
 * a file on disk and a public page all want — and it is read on demand rather
 * than at import so a test can configure one without rebuilding the world.
 */
export function configuredClientId(): string | undefined {
  const id = import.meta.env.VITE_WORKOS_CLIENT_ID;
  return id ? id : undefined;
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
  return new URL("./", window.location.href).href;
}
