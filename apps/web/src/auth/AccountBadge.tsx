import { useEffect, useRef, useState } from "react";
import { useAccount, type Account } from "./Account.tsx";
import { useSync, type Sync } from "../sync/SyncProvider.tsx";
import { ThemeMenu } from "../theme/ThemeMenu.tsx";
import { useApi } from "../sync/useApi.ts";
import { useInvites } from "../share/useInvites.ts";
import { useProfile } from "../sync/useProfile.ts";
import { shownAs } from "../profile/shownAs.ts";
import type { ProfilePage } from "../profile/route.ts";
import { useDismiss } from "../ui/useDismiss.ts";

/**
 * The one menu at the end of the bar, for everyone.
 *
 * Signed in, it is the name: the one they chose to be shown as, else
 * their first name: a light on it says whether this device is syncing.
 * Profile and the theme sit under it as a list; the profile owns the sync
 * controls and the rest of the account. Continuing a run is the shelf's
 * business, not the menu's. Signed out, it is "Menu" with the two doors in,
 * Design and the theme. On disk or the public page, where there is nothing
 * to sign into, it is the same menu
 * without the doors, so the header is the same shape everywhere, and the
 * theme and the designer are never lost for want of an account.
 *
 * This lives apart from the provider because it reads two contexts, the
 * account's and sync's, and sync's provider reads the account's: a badge
 * inside Account.tsx would have made the two files import each other.
 */
export interface MenuActions {
  /** Opens the profile, on the page named: the default page absent one. */
  onOpenProfile?: (page?: ProfilePage) => void;
  /** Opens the local theme library and editor. */
  onOpenThemes?: () => void;

  /**
   * Closes the menu again whenever this changes: the current view, say.
   * Without it the menu stayed open across a page change, with no way to
   * close it but its own toggle.
   */
  closeKey?: unknown;

  /**
   * Doors the bar could not hold, at the widths where it cannot hold them.
   *
   * On a phone the row is measured in single characters, and the mark, the
   * way back to the run, the shelf and this menu fill it. Create and Guide
   * come in here instead of onto a second row. The bar sends them only at
   * those widths, so there is one of each door in the page and it is the
   * one that can be reached.
   */
  sections?: MenuSection[];
}

/** A door the bar handed over, with whether it is the page you are on. */
export interface MenuSection {
  label: string;
  hint?: string;
  current?: boolean;
  act: () => void;
}

export function AccountBadge(actions: MenuActions = {}) {
  const account = useAccount();
  if (account.status === "signed-in") return <AccountMenu account={account} {...actions} />;
  return <GuestMenu account={account} {...actions} />;
}

/** The doors the bar handed over, drawn as the menu's own lines. */
function Sections({ sections, close }: { sections?: MenuSection[]; close: () => void }) {
  if (!sections || sections.length === 0) return null;
  return (
    <div className="menuSections">
      {sections.map((s) => (
        <button
          key={s.label}
          role="menuitem"
          className="accountItem"
          aria-current={s.current ? "page" : undefined}
          onClick={() => {
            close();
            s.act();
          }}
        >
          <span>{s.label}</span>
          {s.hint && <span className="muted small">{s.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/** The menu for somebody not signed in, or somewhere with nothing to sign into. */
function GuestMenu({
  account,
  onOpenProfile,
  onOpenThemes,
  closeKey,
  sections,
}: MenuActions & { account: Exclude<Account, { status: "signed-in" }> }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (rootRef.current) rootRef.current.open = false;
    setOpen(false);
  };
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
        <Sections sections={sections} close={close} />
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
        {/* The lights first: the one thing here somebody changes on a whim. */}
        <div className="menuTheme">
          <ThemeMenu
            {...(onOpenThemes
              ? {
                  onOpenThemes: () => {
                    close();
                    onOpenThemes();
                  },
                }
              : {})}
          />
        </div>
        {/*
          The rest of this device's settings. A signed-out person has no
          profile to speak of, and this is their only door to the page
          the settings live on; signed in, Profile is that door.
        */}
        {onOpenProfile && (
          <button
            role="menuitem"
            className="accountItem"
            onClick={() => {
              setOpen(false);
              onOpenProfile("settings");
            }}
          >
            <span>Settings</span>
            <span className="muted small">sounds, dice, rolls</span>
          </button>
        )}
      </div>
    </details>
  );
}

/** The light's color, from where sync stands. */
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

function AccountMenu({
  account,
  onOpenProfile,
  onOpenThemes,
  closeKey,
  sections,
}: MenuActions & { account: Extract<Account, { status: "signed-in" }> }) {
  const { user, signOut } = account;
  const sync = useSync();
  const { profile } = useProfile();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (rootRef.current) rootRef.current.open = false;
    setOpen(false);
  };
  useDismiss(rootRef, open, close);
  useEffect(() => setOpen(false), [closeKey]);
  const api = useApi();
  const invitations = useInvites(api, open);
  const waiting = invitations.invites.length;
  // The button: the name they chose, else their first name, else the
  // deliberately generic name. An address is private on a shared screen.
  const label = profile?.handle?.trim() || user.firstName?.trim() || "Account";
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
    ...(onOpenProfile ? [{ label: "Profile", hint: "your keys, your data, your devices", act: () => onOpenProfile() }] : []),
    // The invitations themselves live on the profile's Social page now; the
    // menu is only ever the door to them, and only where there is a reason
    // to open it.
    ...(onOpenProfile && waiting > 0
      ? [{ label: `Invitations (${waiting})`, hint: "people asking you to their table", act: () => onOpenProfile("social") }]
      : []),
  ];

  return (
    <details ref={rootRef} className="account accountMenu" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      {/* No address in the tooltip either: on a shared screen a hover is
          as public as a line of text, and the profile page says who you
          are signed in as. */}
      <summary
        aria-label={`Account menu for ${label}${waiting ? `, ${waiting} invitation${waiting === 1 ? "" : "s"} waiting` : ""}${tone ? `, ${syncLabel(sync)}` : ""}`}
      >
        {tone && <span className={`led ${tone}`} title={syncLabel(sync)} aria-hidden="true" />}
        <span className="accountLabel">{label}</span>
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
        <Sections sections={sections} close={() => setOpen(false)} />
        {tone && <div className={`accountSync small ${tone}`}>{syncLabel(sync)}</div>}
        {shown && shown !== label && (
          <div className="accountWho">
            <div className="accountName">{shown}</div>
          </div>
        )}
        {/* The lights, first: the one thing in here changed on a whim. */}
        <div className="menuTheme">
          <ThemeMenu
            {...(onOpenThemes
              ? {
                  onOpenThemes: () => {
                    close();
                    onOpenThemes();
                  },
                }
              : {})}
          />
        </div>
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
