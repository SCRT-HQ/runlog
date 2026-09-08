import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
// The badge and menu are in AccountBadge.tsx: they read sync's context too,
// and sync's provider reads this one.
import { createClient, type User } from "@workos-inc/authkit-js";
import { baseOf, honestAddress } from "../welcome/route.ts";
import { appUrl, configuredClientId } from "./config.ts";

/**
 * Who is here, if anyone.
 *
 * The app never needs an account: everything it does happens on this machine,
 * and a copy on disk or on a public page has nobody to sign in with. Where a
 * build does know an AuthKit client, signing in is an offer in the header, not
 * a door — it unlocks what a server adds (sync, on by default once you have
 * signed in; a switch on this device turns it off) and gates nothing.
 * The first paint is always the app; WorkOS is asked in the background.
 *
 * The SDK does the awkward part: it notices the `?code=` AuthKit sends back,
 * exchanges it, tidies the URL, and keeps the session alive. This only has to
 * report what that ended with, and hand out a token when something asks.
 */

export type Account =
  /** Nothing to sign into: no client configured. Disk, Pages, the tests. */
  | { status: "local" }
  /** A session may exist; WorkOS is being asked. Sign-in queues behind it. */
  | { status: "checking"; signIn: () => void }
  /** `signUp` lands on AuthKit's create-an-account screen; the same door, the other sign. */
  | { status: "anonymous"; signIn: () => void; signUp: () => void; problem?: string }
  | {
      status: "signed-in";
      user: User;
      signOut: () => void;
      /** A fresh access token, refreshed by the SDK when it has to be. */
      getAccessToken: () => Promise<string>;
    };

/** Exported for tests, which need to stand in a signed-in state without WorkOS. */
export const AccountContext = createContext<Account>({ status: "local" });

/** The account, or `local` where there is nothing to sign into. */
export function useAccount(): Account {
  return useContext(AccountContext);
}

type Client = Awaited<ReturnType<typeof createClient>>;

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account>(() =>
    configuredClientId()
      ? // Until the client exists a click can only mean "when you can":
        // reloading is the honest way to try again from the top.
        { status: "checking", signIn: () => window.location.reload() }
      : { status: "local" },
  );

  useEffect(() => {
    const clientId = configuredClientId();
    if (!clientId) return;

    let disposed = false;
    let client: Client | undefined;
    // AuthKit sends people back to the bare address with a code the SDK
    // reads and removes. What is left would be the welcome page on a
    // reload, so the address is moved under the app once the SDK is done.
    const returning = /[?&]code=/.test(location.search);

    // Where to come back to. Sign-in leaves the page and returns to the
    // app's bare address, which would lose a deep link — a widget, a guide
    // page, a dock's address in a streaming app — so the hash rides along
    // as `state` and is put back on return. The value comes back through a
    // URL nobody signs, so only a hash is accepted, and only ever set as
    // one: a hash cannot send the page anywhere else.
    const returnTo = () => ({ state: { returnTo: location.hash } });
    const anonymous = (c: Client | undefined, problem?: string) =>
      setAccount({
        status: "anonymous",
        signIn: c ? () => void c.signIn(returnTo()) : () => window.location.reload(),
        signUp: c ? () => void c.signUp(returnTo()) : () => window.location.reload(),
        ...(problem ? { problem } : {}),
      });

    void createClient(clientId, {
      // The SDK's "dev mode" keeps the refresh token in localStorage rather
      // than in a cookie on api.workos.com. That cookie is third-party from
      // here, and browsers increasingly refuse it, so a reload came back
      // signed out; localStorage survives. WorkOS calls this development-only
      // because a script on the page could read the token — and no script
      // runs on this page but our own, the edge's policy sees to that. The
      // proper fix is a custom auth domain, which makes the cookie
      // first-party; until then this is the trade, made knowingly.
      devMode: true,
      redirectUri: appUrl(),
      onRedirectCallback: ({ state }) => {
        const back = (state as { returnTo?: unknown } | undefined)?.returnTo;
        if (typeof back === "string" && /^#[A-Za-z0-9_\-/?=&.%:]{1,2000}$/.test(back)) location.hash = back;
      },
      onRefreshFailure: ({ signIn }) =>
        setAccount({ status: "anonymous", signIn: () => void signIn(returnTo()), signUp: () => void signIn(returnTo()) }),
    })
      .then((c) => {
        if (disposed) {
          c.dispose();
          return;
        }
        client = c;
        const user = c.getUser();
        if (returning) {
          const honest = honestAddress({ protocol: location.protocol, pathname: location.pathname, base: baseOf(location.href), hash: location.hash, search: location.search });
          if (honest) history.replaceState(null, "", honest);
        }
        if (user) {
          setAccount({
            status: "signed-in",
            user,
            signOut: () => c.signOut({ returnTo: appUrl() }),
            getAccessToken: () => c.getAccessToken(),
          });
        } else {
          anonymous(c);
        }
      })
      .catch((error: unknown) => {
        if (disposed) return;
        anonymous(undefined, error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
      client?.dispose();
    };
  }, []);

  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

