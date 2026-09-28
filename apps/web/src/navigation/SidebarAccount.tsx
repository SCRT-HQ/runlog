import { useState } from "react";
import { useAccount } from "../auth/Account.tsx";
import { syncName, syncTone } from "../auth/AccountBadge.tsx";
import type { ProfilePage } from "../profile/route.ts";
import { useInvites } from "../share/useInvites.ts";
import { useSync } from "../sync/SyncProvider.tsx";
import { useApi } from "../sync/useApi.ts";
import { useProfile } from "../sync/useProfile.ts";
import { useThemes } from "../theme/ThemeProvider.tsx";
import { SidebarItem, type SidebarAction } from "./SidebarItem.tsx";

/** Account identity and actions stay at the foot of both the rail and drawer. */
export function SidebarAccount({
  visible,
  profileCurrent,
  themesCurrent,
  onOpenProfile,
  onOpenThemes,
  onAccountAction,
  perform,
}: {
  visible: boolean;
  profileCurrent: boolean;
  themesCurrent: boolean;
  onOpenProfile: (page?: ProfilePage) => Promise<boolean>;
  onOpenThemes: () => Promise<boolean>;
  onAccountAction: (action: () => void) => Promise<boolean>;
  perform: (action: SidebarAction) => Promise<void>;
}) {
  const account = useAccount();
  const sync = useSync();
  const { profile } = useProfile();
  const api = useApi();
  const { invites } = useInvites(api, visible);
  const themes = useThemes();
  const [resetting, setResetting] = useState(false);
  const signedIn = account.status === "signed-in";
  const label = signedIn ? profile?.handle?.trim() || account.user.firstName?.trim() || "Account" : "On this device";
  const tone = signedIn ? syncTone(sync) : null;
  const status = tone ? syncName(sync) : signedIn ? "Signed in" : "Local settings";

  return (
    <div className="sidebarAccount">
      <div className="sidebarIdentity" title={`${label} · ${status}`}>
        <span className="sidebarAvatar" aria-hidden="true">
          {signedIn ? Array.from(label)[0]?.toUpperCase() : "—"}
        </span>
        <div className="sidebarIdentityText">
          <strong>{label}</strong>
          <span className="sidebarStatus">
            {tone && <span className={`led ${tone}`} aria-hidden="true" />}
            {status}
          </span>
        </div>
      </div>
      <SidebarItem
        label={signedIn ? "Profile" : "Settings"}
        icon="profile"
        current={profileCurrent}
        onClick={() => void perform(() => onOpenProfile(signedIn ? undefined : "settings"))}
      />
      {signedIn && invites.length > 0 && (
        <SidebarItem label={`Invitations (${invites.length})`} icon="invites" onClick={() => void perform(() => onOpenProfile("social"))} />
      )}
      <SidebarItem label="Manage Themes" icon="themes" current={themesCurrent} onClick={() => void perform(onOpenThemes)} />
      <SidebarItem
        label="Revert Default Theme"
        icon="reset"
        disabled={resetting}
        onClick={() => {
          setResetting(true);
          void perform(themes.applySystem).finally(() => setResetting(false));
        }}
      />
      {account.status === "signed-in" && (
        <SidebarItem label="Sign Out" icon="signOut" onClick={() => void perform(() => onAccountAction(account.signOut))} />
      )}
      {(account.status === "anonymous" || account.status === "checking") && (
        <SidebarItem
          label="Sign in"
          icon="signIn"
          disabled={account.status === "checking"}
          onClick={() => void perform(() => onAccountAction(account.signIn))}
        />
      )}
      {account.status === "anonymous" && (
        <>
          <SidebarItem label="Create an account" icon="profile" onClick={() => void perform(() => onAccountAction(account.signUp))} />
          {account.problem && (
            <p className="sidebarProblem" role="status">
              {account.problem}
            </p>
          )}
        </>
      )}
    </div>
  );
}
