import { appBase, PATHS_ON } from "../route.ts";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
// The badge and menu are in AccountBadge.tsx: they read sync's context too,
// and sync's provider reads this one.
import { createClient, type User } from "@workos-inc/authkit-js";
import { honestAddress, isAppPath } from "../welcome/route.ts";
import { appUrl, configuredClientId } from "./config.ts";
import { whoIsHere } from "../storage/who.ts";

/**
 * Who is here, if anyone.
 *
 * The app never needs an account: everything it does happens on this machine,
 * and a copy on disk or on a public page has nobody to sign in with. Where a
 * build does know an AuthKit client, signing in is an offer in the header, not
 * a door, it unlocks what a server adds (sync, on by default once you have
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

/** Where a sign-in started, in this tab, for a return that comes back without its `state`. */
export const RETURN_KEY = "runlog:sign-in-return";

function keepReturn(back: string): void {
  try {
    sessionStorage.setItem(RETURN_KEY, back);
  } catch {
    /* a private window: `state` alone carries it */
  }
}

function keptReturn(): string | null {
  try {
    return sessionStorage.getItem(RETURN_KEY);
  } catch {
    return null;
  }
}

function forgetReturn(): void {
  try {
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    /* nothing kept */
  }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account>(() =>
    configuredClientId()
      ? // Until the client exists a click can only mean "when you can":
        // reloading is the honest way to try again from the top.
        { status: "checking", signIn: () => window.location.reload() }
      : { status: "local" },
  );

  /**
   * Tell the device whose data to keep, and to stop keeping the last
   * person's.
   *
   * Everything on this machine used to live under one name, so signing
   * out cleared nothing and the next person to open the app saw the shelf
   * of whoever was here last. Storage waits for this before it opens
   * anything; see storage/who.ts.
   *
   * `checking` says nothing on purpose. It is the state where the answer
   * is not known yet, and guessing it would be guessing exactly the thing
   * that must not be guessed.
   */
  useEffect(() => {
    if (account.status === "checking") return;
    whoIsHere(
      account.status === "signed-in"
        ? { kind: "account", id: account.user.id }
        : account.status === "local"
          ? { kind: "local" }
          : { kind: "anon" },
    );
  }, [account.status, account.status === "signed-in" ? account.user.id : null]);

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
    // app's bare address, which would lose a deep link, a widget, a guide
    // page, a dock's address in a streaming app, so the hash rides along
    // as `state` and is put back on return. The value comes back through a
    // URL nobody signs, so only a hash is accepted, and only ever set as
    // one: a hash cannot send the page anywhere else.
    //
    // It is also kept in this tab's sessionStorage, because a sign-in can
    // come back without its `state`. Read only on a return, taken whether
    // or not the return worked, and checked exactly as `state` is, so it
    // cannot move a later load.
    const returnTo = () => {
      const back = PATHS_ON ? `${location.pathname}${location.search}${location.hash}` : location.hash;
      keepReturn(back);
      return { state: { returnTo: back } };
    };
    const saved = returning ? keptReturn() : null;
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
      // because a script on the page could read the token, and no script
      // runs on this page but our own, the edge's policy sees to that. The
      // proper fix is a custom auth domain, which makes the cookie
      // first-party; until then this is the trade, made knowingly.
      devMode: true,
      redirectUri: appUrl(),
      onRedirectCallback: ({ state }) => {
        forgetReturn();
        const named = (state as { returnTo?: unknown } | undefined)?.returnTo;
        // `state` wins; the tab's own copy is for a return that lost it.
        const back = typeof named === "string" ? named : saved;
        // A hash cannot send the page anywhere else. A path is accepted only
        // where paths are on, only under the app's own base, only a section
        // the app answers to, and only as an in-page change, so neither can
        // either. Every section, rather than `play` alone: they moved to
        // the root, and the check did not follow, so signing in from a
        // packs, guide, marketplace, run or seat address lost it.
        if (typeof back !== "string") return;
        if (/^#[A-Za-z0-9_\-/?=&.%:]{1,2000}$/.test(back)) location.hash = back;
        else if (PATHS_ON && /^\/[A-Za-z0-9_\-/?=&.%:#]{1,2000}$/.test(back) && isAppPath(back.split(/[?#]/)[0]!, appBase(location.href))) {
          history.replaceState(null, "", back);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
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
          // A return that failed never reached the callback; its copy goes too.
          forgetReturn();
          const honest = honestAddress({
            protocol: location.protocol,
            pathname: location.pathname,
            base: appBase(location.href),
            hash: location.hash,
            search: location.search,
          });
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
        if (returning) forgetReturn();
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
