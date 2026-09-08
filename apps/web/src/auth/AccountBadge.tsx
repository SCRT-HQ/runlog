import { useEffect, useRef, useState } from "react";
import { useAccount, type Account } from "./Account.tsx";
import { useSync, type Sync } from "../sync/SyncProvider.tsx";
import { ThemeMenu } from "../theme/ThemeMenu.tsx";
import { useApi } from "../sync/useApi.ts";
import { useInvites } from "../share/useInvites.ts";
import { useProfile } from "../sync/useProfile.ts";
import { shownAs } from "../profile/shownAs.ts";
import { useDismiss } from "../ui/useDismiss.ts";

/**
 * The one menu at the end of the bar, for everyone.
 *
 * Signed in, it is the name — the one they chose to be shown as, else
 * their first name: a light on it says whether this device is syncing,
 * and the switch behind it is the one decision that is the player's.
 * Profile and the theme sit under it as a list, so billing and publishing
 * are each a line when they arrive. Continuing a run is the shelf's
 * business, not the menu's. Signed out, it is "Menu" with the two doors in,
 * Design and the theme. On disk or the public page, where there is nothing
 * to sign into, it is the same menu
 * without the doors — so the header is the same shape everywhere, and the
 * theme and the designer are never lost for want of an account.
 *
 * This lives apart from the provider because it reads two contexts, the
 * account's and sync's, and sync's provider reads the account's: a badge
 * inside Account.tsx would have made the two files import each other.
 */
export interface MenuActions {
  onOpenProfile?: () => void;
  /** Accept an invitation from the menu and open the run it is for. */
  onJoinInvite?: (token: string) => Promise<void>;
  /**
   * Closes the menu again whenever this changes — the current view, say.
   * Without it the menu stayed open across a page change, with no way to
   * close it but its own toggle.
   */
  closeKey?: unknown;
}

export function AccountBadge(actions: MenuActions = {}) {
  const account = useAccount();
  if (account.status === "signed-in") return <AccountMenu account={account} {...actions} />;
  return <GuestMenu account={account} {...actions} />;
}

/** The menu for somebody not signed in, or somewhere with nothing to sign into. */
function GuestMenu({ account, closeKey }: MenuActions & { account: Exclude<Account, { status: "signed-in" }> }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const rootRef = useRef<HTMLDetailsElement>(null);
  useDismiss(rootRef, open, close);
  useEffect(close, [closeKey]);
  return (
    <details ref={rootRef} className="account accountMenu" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary aria-label="Menu">
        Menu
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="accountPanel" role="menu">
        {account.status !== "local" && (
          <div className="menuDoors">
            <button
              className="primary"
              disabled={account.status === "checking"}
              aria-busy={account.status === "checking" || undefined}
              title={account.status === "anonymous" ? account.problem : undefined}
              onClick={() => {
                close();
                if (account.status === "anonymous") account.signIn();
              }}
            >
              Sign in
            </button>
            {account.status === "anonymous" && (
              <button
                className="ghost"
                onClick={() => {
                  close();
                  account.signUp();
                }}
              >
                Create an account
              </button>
            )}
          </div>
        )}
        <div className="menuTheme">
          <ThemeMenu />
        </div>
      </div>
    </details>
  );
}

/** The light's colour, from where sync stands. */
export type Tone = "off" | "fine" | "busy" | "warn";

export function syncTone(sync: Pick<Sync, "available" | "enabled" | "status">): Tone | null {
  if (!sync.available) return null;
  if (!sync.enabled) return "off";
  if (sync.status === "syncing") return "busy";
  if (sync.status === "synced" || sync.status === "idle" || sync.status === "off") return "fine";
  return "warn";
}

export function syncLabel(sync: Pick<Sync, "enabled" | "status" | "last">): string {
  if (!sync.enabled) return "Sync is off on this device";
  switch (sync.status) {
    case "syncing":
      return "Syncing…";
    case "synced":
    case "idle":
    case "off":
      return sync.last ? `Synced ${ago(sync.last.at)}` : "Waiting for the first pass";
    case "offline":
      return "Offline. It will catch up when the network is back";
    case "unauthorized":
      return "Sync paused. Sign in again";
    case "too-large":
      return "Sync paused. A run is too large to send";
    default:
      return "Sync paused";
  }
}

function AccountMenu({ account, onOpenProfile, onJoinInvite, closeKey }: MenuActions & { account: Extract<Account, { status: "signed-in" }> }) {
  const { user, signOut } = account;
  const sync = useSync();
  const { profile } = useProfile();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDetailsElement>(null);
  useDismiss(rootRef, open, () => setOpen(false));
  useEffect(() => setOpen(false), [closeKey]);
  const api = useApi();
  const invitations = useInvites(api, open);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const waiting = invitations.invites.length;
  // The button: the name they chose, else their first name, else the address.
  const label = profile?.handle?.trim() || user.firstName || user.email;
  // The panel's head: the name others see, when the button is not already showing it.
  const shown = shownAs(profile);
  const tone = syncTone(sync);

  // "Synced 40 s ago" keeps counting while the menu is open.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [open]);

  const entries: Array<{ label: string; hint?: string; act: () => void }> = [
    ...(onOpenProfile ? [{ label: "Profile", hint: "your keys, your data, your devices", act: onOpenProfile }] : []),
  ];

  return (
    <details ref={rootRef} className="account accountMenu" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary title={user.email} aria-label={`Account menu for ${label}${waiting ? `, ${waiting} invitation${waiting === 1 ? "" : "s"} waiting` : ""}`}>
        {tone && <span className={`led ${tone}`} title={syncLabel(sync)} aria-hidden="true" />}
        {label}
        {waiting > 0 && (
          <span className="menuBadge" title={`${waiting} invitation${waiting === 1 ? "" : "s"} waiting`}>
            {waiting}
          </span>
        )}
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="accountPanel" role="menu">
        <div className="accountWho">
          {shown && shown !== label && <div className="accountName">{shown}</div>}
          {user.email && <div className="muted small accountEmail">{user.email}</div>}
        </div>
        {sync.available && (
          <div className="syncSection">
            {/* The words are in the tooltip: a menu is a list, not a page. */}
            <label title="Runs go to your account and back to your other devices; a pack's text stays here unless you switch it on from the shelf.">
              <input type="checkbox" checked={sync.enabled} onChange={(e) => sync.setEnabled(e.target.checked)} />
              <span>Sync on this device</span>
              {tone && <span className={`led ${tone}`} aria-hidden="true" />}
            </label>
            {sync.enabled && (
              <div className="syncRow">
                <button className="ghost tiny" onClick={sync.syncNow} disabled={sync.status === "syncing"}>
                  Sync now
                </button>
                <span className="muted small">{syncLabel(sync)}</span>
              </div>
            )}
          </div>
        )}
        {waiting > 0 && (
          <details className="accountSub" open={invitesOpen} onToggle={(e) => setInvitesOpen(e.currentTarget.open)}>
            <summary className="accountItem" role="menuitem" aria-haspopup="true">
              <span>
                Invitations <span className="menuBadge">{waiting}</span>
              </span>
              <span className="muted small">people asking you to their table</span>
            </summary>
            <ul className="inviteList" aria-label="Invitations waiting for you">
              {invitations.invites.map((invite) => {
                const busy = busyToken === invite.token;
                const act = async (what: "join" | "decline") => {
                  setBusyToken(invite.token);
                  try {
                    if (what === "join") {
                      await onJoinInvite?.(invite.token);
                      setOpen(false);
                    } else await api?.declineInvite(invite.token);
                    invitations.forget(invite.token);
                  } finally {
                    setBusyToken(null);
                  }
                };
                return (
                  <li key={invite.token}>
                    <div className="inviteWords">
                      <b>{invite.session ?? invite.packTitle ?? "A run"}</b>
                      <span className="muted small">
                        {invite.inviter ?? "Someone"} asks you in as {invite.role === "viewer" ? "a watcher" : "a player"}
                        {invite.session && invite.packTitle ? ` · ${invite.packTitle}` : ""}
                      </span>
                    </div>
                    <div className="inviteActs">
                      <button className="primary tiny" disabled={busy || !onJoinInvite} aria-busy={busy || undefined} onClick={() => void act("join")}>
                        {invite.alreadyIn ? "Open" : "Join"}
                      </button>
                      <button className="ghost tiny" disabled={busy} onClick={() => void act("decline")}>
                        Decline
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
        {entries.map((e) => (
          <button
            key={e.label}
            role="menuitem"
            className="accountItem"
            onClick={() => {
              setOpen(false);
              e.act();
            }}
          >
            <span>{e.label}</span>
            {e.hint && <span className="muted small">{e.hint}</span>}
          </button>
        ))}
        <div className="menuTheme">
          <ThemeMenu />
        </div>
        <button
          role="menuitem"
          className="accountItem"
          onClick={() => {
            setOpen(false);
            signOut();
          }}
        >
          <span>Sign out</span>
        </button>
      </div>
    </details>
  );
}

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
