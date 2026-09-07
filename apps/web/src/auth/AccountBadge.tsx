import { useEffect, useState } from "react";
import { useAccount, type Account } from "./Account.tsx";
import { useSync, type Sync } from "../sync/SyncProvider.tsx";
import { ThemeMenu } from "../theme/ThemeMenu.tsx";

/**
 * The one menu at the end of the bar, for everyone.
 *
 * Signed in, it is the name: a light on it says whether this device is
 * syncing, and the switch behind it is the one decision that is the
 * player's. Continue, Profile, Design and the theme sit under it as a list,
 * so billing and publishing are each a line when they arrive. Signed out,
 * it is "Menu" with the two doors in, Design and the theme. On disk or the
 * public page, where there is nothing to sign into, it is the same menu
 * without the doors — so the header is the same shape everywhere, and the
 * theme and the designer are never lost for want of an account.
 *
 * This lives apart from the provider because it reads two contexts, the
 * account's and sync's, and sync's provider reads the account's: a badge
 * inside Account.tsx would have made the two files import each other.
 */
export interface MenuActions {
  onOpenProfile?: () => void;
  onContinue?: () => void;
}

export function AccountBadge(actions: MenuActions = {}) {
  const account = useAccount();
  if (account.status === "signed-in") return <AccountMenu account={account} {...actions} />;
  return <GuestMenu account={account} {...actions} />;
}

/** The menu for somebody not signed in, or somewhere with nothing to sign into. */
function GuestMenu({ account }: MenuActions & { account: Exclude<Account, { status: "signed-in" }> }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <details className="account accountMenu" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
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

function AccountMenu({ account, onOpenProfile, onContinue }: MenuActions & { account: Extract<Account, { status: "signed-in" }> }) {
  const { user, signOut } = account;
  const sync = useSync();
  const [open, setOpen] = useState(false);
  const label = user.firstName ?? user.email;
  const tone = syncTone(sync);

  // "Synced 40 s ago" keeps counting while the menu is open.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [open]);

  const entries: Array<{ label: string; hint?: string; act: () => void }> = [
    ...(onContinue ? [{ label: "Continue where you left off", hint: "open your last run", act: onContinue }] : []),
    ...(onOpenProfile ? [{ label: "Profile", hint: "your keys, your data, your devices", act: onOpenProfile }] : []),
  ];

  return (
    <details className="account accountMenu" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary title={user.email} aria-label={`Account menu for ${label}`}>
        {tone && <span className={`led ${tone}`} title={syncLabel(sync)} aria-hidden="true" />}
        {label}
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="accountPanel" role="menu">
        {user.email && <div className="muted small accountEmail">{user.email}</div>}
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
