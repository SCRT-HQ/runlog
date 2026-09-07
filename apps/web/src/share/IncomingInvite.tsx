import { useEffect, useState } from "react";
import { an } from "@runlog/rules-schema";
import { useAccount } from "../auth/Account.tsx";
import { peekInvite, type InvitePeek } from "../sync/client.ts";
import { apiBase } from "../sync/config.ts";

/**
 * An invitation that arrived in a link.
 *
 * `?join=<token>` is read once, taken off the address bar so a reload does
 * not re-offer it, and kept in sessionStorage until it has been acted on —
 * because acting on it usually means signing in first, and sign-in is a
 * round trip through WorkOS that comes back to a fresh page. What the link
 * is for is asked of the API without an account, so the banner can say
 * whose table this is before asking anyone to sign in.
 */

const KEY = "runlog:join";

export interface IncomingInvite {
  token: string;
  peek: InvitePeek | null;
  /** The link could not be checked: no API here, or it did not answer. */
  problem?: string;
}

function readToken(): string | null {
  try {
    const url = new URL(location.href);
    const fromUrl = url.searchParams.get("join");
    if (fromUrl) {
      url.searchParams.delete("join");
      history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
      sessionStorage.setItem(KEY, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function useIncomingInvite(): { invite: IncomingInvite | null; clear: () => void } {
  const [invite, setInvite] = useState<IncomingInvite | null>(null);
  const account = useAccount();
  // Asked once the account is known, so the answer can say whether the
  // link is this account's; "checking" is not yet an answer.
  const signedIn = account.status === "signed-in" ? account : null;
  const settled = account.status !== "checking";

  useEffect(() => {
    if (!settled) return;
    const token = readToken();
    if (!token) return;
    const base = apiBase();
    if (!base) {
      setInvite({ token, peek: null, problem: "this copy of the app has no account to join with" });
      return;
    }
    let live = true;
    (signedIn ? signedIn.getAccessToken().catch(() => undefined) : Promise.resolve(undefined))
      .then((access) => peekInvite(base, token, access))
      .then(
        (peek) => live && setInvite({ token, peek }),
        () => live && setInvite({ token, peek: null, problem: "the invitation could not be checked just now" }),
      );
    return () => {
      live = false;
    };
  }, [settled, signedIn]);

  const clear = () => {
    setInvite(null);
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* nothing to do */
    }
  };
  return { invite, clear };
}

export function InviteBanner({
  invite,
  packTitle,
  busy,
  onJoin,
  onDismiss,
}: {
  invite: IncomingInvite;
  /** The pack's title where it is on this device; the id otherwise. */
  packTitle: (packId: string) => string | null;
  busy: boolean;
  onJoin: () => void;
  onDismiss: () => void;
}) {
  const account = useAccount();
  const { peek, problem } = invite;

  if (problem || !peek) {
    return (
      <div className="incoming bad">
        <span>Someone invited you to a run, but {problem ?? "the link is not one this app knows"}.</span>
        <button className="ghost" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    );
  }
  if (!peek.found) {
    return (
      <div className="incoming bad">
        <span>That invitation has expired, was withdrawn, or was already used by somebody else.</span>
        <button className="ghost" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    );
  }

  const { inviter, session, packId, role, accepted, sentTo, forYou, alreadyIn } = peek.invite;
  // The pack's title as this device knows it, else as the server recorded it, else the id.
  const title = packTitle(packId) ?? peek.invite.packTitle;
  const here = packTitle(packId) !== null;
  const watching = role === "viewer";

  // Signed in as somebody else: say so, and offer the way to switch. The
  // token stays put, so the banner is back after the sign-in round trip.
  if (account.status === "signed-in" && forYou === false && !alreadyIn) {
    return (
      <div className="incoming bad">
        <div className="incomingWhat">
          <strong>{inviter ?? "Somebody"}</strong>
          <span> invited </span>
          <strong>{sentTo}</strong>
          <span> to {session ?? `${an(title ?? packId)} run`}, and you are signed in as {account.user.email}.</span>
          <div className="muted small">Sign out, then sign in with that address or create an account for it, and this invitation will be waiting.</div>
        </div>
        <div className="incomingActions">
          <button className="primary" onClick={account.signOut}>
            Sign out to switch
          </button>
          <button className="ghost" onClick={onDismiss}>
            Not now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="incoming">
      <div className="incomingWhat">
        <strong>{inviter ?? "Somebody"}</strong>
        <span> invited you to {watching ? "watch" : "play"} </span>
        <strong>{session ?? `${an(title ?? packId)} run`}</strong>
        {session && <span className="muted"> · {title ?? packId}</span>}
        {!here && (
          <div className="muted small">
            The pack ({title ?? packId}) is not on this device yet. Joining works now; load the pack from the shelf to play.
          </div>
        )}
        {alreadyIn && <div className="muted small">You are already at this table; joining opens it.</div>}
        {accepted && !alreadyIn && <div className="muted small">This link has been used once already. If that was you, joining again is fine.</div>}
        {forYou === null && <div className="muted small">Sent to {sentTo}. Sign in with that address to join.</div>}
      </div>
      <div className="incomingActions">
        {account.status === "signed-in" ? (
          <button className="primary" disabled={busy} onClick={onJoin}>
            {busy ? "Joining…" : "Join"}
          </button>
        ) : account.status === "anonymous" ? (
          // Whoever this was sent to may or may not have an account yet;
          // both doors are here, and the invitation waits behind either.
          <>
            <button className="primary" onClick={account.signIn}>
              Sign in to join
            </button>
            <button className="ghost" onClick={account.signUp}>
              Create an account
            </button>
          </>
        ) : account.status === "checking" ? (
          <button className="primary" disabled>
            Sign in to join
          </button>
        ) : null}
        <button className="ghost" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
