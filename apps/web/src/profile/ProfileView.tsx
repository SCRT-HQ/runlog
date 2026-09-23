import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, type Account } from "../auth/Account.tsx";
import { useSync, type Sync } from "../sync/SyncProvider.tsx";
import { createApi, SyncError, type Api, type Person, type Profile, type PublisherInvitation } from "../sync/client.ts";
import { apiBase } from "../sync/config.ts";
import { syncBus } from "../sync/bus.ts";
import { rememberProfile } from "../sync/useProfile.ts";
import { usePlan, type PlanState } from "../sync/usePlan.ts";
import { useInvites } from "../share/useInvites.ts";
import { liveLinkOf } from "../live/route.ts";
import {
  PROFILE_PAGES,
  profileAccessFor,
  profileHash,
  visibleProfilePages,
  type ProfilePage,
  type ProfilePageDescriptor,
  type ServerAvailability,
} from "./route.ts";
import { useTitle } from "../title.ts";
import { DeviceSettings } from "../settings/DeviceSettings.tsx";
import { SetupsSection } from "./SetupsSection.tsx";
import { useAlertSettings } from "../alerts/useAlerts.ts";
import { ConnectionsSection } from "../connections/ConnectionsSection.tsx";
import { PlanSection } from "./PlanSection.tsx";
import { PublisherSection } from "./PublisherSection.tsx";
import { DeveloperKeysPage } from "./DeveloperKeysPage.tsx";
import { PurchasesSection } from "./PurchasesSection.tsx";
import { ServersPage } from "./ServersPage.tsx";
import { DataExport, ServerDelete } from "./DataActions.tsx";
import { LicenseRow } from "./LicenseRow.tsx";
import {
  forgetLicense,
  forgetSyncState,
  listLicenses,
  listPacks,
  listRuns,
  listSyncState,
  type StoredLicense,
  type StoredPack,
  type StoredRun,
} from "../storage/db.ts";
import { onWhoChanged, whoAmI, whoSoFar, type Who } from "../storage/who.ts";

/**
 * The person's page, in four: who the account is, what it sells, what it
 * pays for and holds, and who it plays with. It used to be one seven-screen
 * scroll of all of that at once; splitting it is the whole point of this
 * file, so each page below stays narrow on purpose.
 *
 * Everything shown comes from this machine first. The server is asked
 * once, to stamp the visit and hand back the profile row, and if that
 * fails the page is still whole: local runs, local packs, local keys.
 */

export interface ProfileViewProps {
  onBack: () => void;
  /** Which of the four pages; the first one absent. */
  page?: ProfilePage;
  /** Moves between pages: wired to the address bar by the caller. */
  onNavigate?: (page: ProfilePage, how?: "push" | "replace") => void;
  /** Opens a run from Social's "Open tables": the library's own way in. */
  onOpenRun?: (runId: string) => void;
  /** Accepts an invitation from Social's list and opens the run it is for. */
  onJoinInvite?: (token: string) => Promise<void>;
}

export function ProfileView({ onBack, page = "profile", onNavigate, onOpenRun, onJoinInvite }: ProfileViewProps) {
  const account = useAccount();
  const base = apiBase();
  const getAccessToken = account.status === "signed-in" ? account.getAccessToken : null;
  const api = useMemo(() => (base && getAccessToken ? createApi(base, getAccessToken) : null), [base, getAccessToken]);
  const session = useRef({ api, generation: 0 });
  if (session.current.api !== api) {
    session.current = { api, generation: session.current.generation + 1 };
  }
  const invitations = useInvites(api, true);
  const plan = usePlan();
  const servers = serverAvailability(plan.state, account);
  const access = profileAccessFor(page, account.status, servers);
  const shownPage = access.kind === "replace" ? access.page : page;
  const pages = visibleProfilePages(account.status, servers, page);
  // Servers keeps its own checking/unavailable/error notices inside the page
  // itself, so a pending Discord claim (its banner, its "Not now") stays
  // reachable even where this deployment does not offer servers at all.
  const serversRouted = page === "servers" && account.status === "signed-in";
  const accountPage: Exclude<ProfilePage, "settings"> | null = serversRouted
    ? "servers"
    : access.kind === "content" && access.page !== "settings"
      ? access.page
      : null;

  const pageLabel = PROFILE_PAGES.find((candidate) => candidate.id === shownPage)?.label;
  useTitle(shownPage === "profile" || !pageLabel ? "Profile" : `${pageLabel} · Profile`);

  useEffect(() => {
    if (access.kind === "replace") onNavigate?.(access.page, "replace");
  }, [access.kind, onNavigate]);

  return (
    <main className="main">
      <div className="profileLayout">
        <ProfileNav
          page={shownPage}
          pages={pages}
          onNavigate={onNavigate}
          waiting={invitations.invites.length}
          application={shownPage !== "account"}
        />
        <div className={`profileBody${shownPage === "account" ? "" : " profileApplicationBody"}`}>
          {shownPage === "settings" ? (
            <SettingsPage />
          ) : accountPage && account.status === "signed-in" ? (
            <AccountProfile
              key={`${account.user.id}:${session.current.generation}`}
              ownerId={account.user.id}
              account={account}
              api={api}
              page={accountPage}
              invitations={invitations}
              onOpenRun={onOpenRun}
              onJoinInvite={onJoinInvite}
              serversAvailability={servers}
              onRetryPlan={() => void plan.refresh()}
            />
          ) : access.kind === "checking" ? (
            <ProfileRouteMessage title="Your account">Checking your account…</ProfileRouteMessage>
          ) : access.kind === "sign-in" && account.status === "anonymous" ? (
            <ProfileSignIn account={account} onBack={onBack} />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function serverAvailability(state: PlanState, account: Account): ServerAvailability {
  if (account.status !== "signed-in") return state.kind === "checking" || state.kind === "loading" ? "checking" : "unavailable";
  if (state.kind === "checking" || state.kind === "loading") return "checking";
  if (state.kind === "error") return state.ownerId === account.user.id ? "error" : "checking";
  if (state.kind !== "ready" || state.ownerId !== account.user.id) return "checking";
  return state.offers.servers ? "available" : "unavailable";
}

function ProfileRouteMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="profile profileApplication">
      <h2>{title}</h2>
      <section className="panel">
        <p className="muted">{children}</p>
      </section>
    </div>
  );
}

function ProfileSignIn({ account, onBack }: { account: Extract<Account, { status: "anonymous" }>; onBack: () => void }) {
  return (
    <div className="profile profileApplication">
      <h2>Your account</h2>
      <section className="panel setup">
        <p className="muted">Sign in to see your account, your license keys, and what sync has carried.</p>
        <div className="padRow">
          <button className="primary" onClick={account.signIn}>
            Sign in
          </button>
          <button className="ghost" onClick={account.signUp}>
            Create an account
          </button>
          <button className="ghost" onClick={onBack}>
            Back to the game
          </button>
        </div>
      </section>
    </div>
  );
}

const isOwner = (who: Who | null, ownerId: string): boolean => who?.kind === "account" && who.id === ownerId;

function AccountProfile({
  ownerId,
  account,
  api,
  page,
  invitations,
  onOpenRun,
  onJoinInvite,
  serversAvailability,
  onRetryPlan,
}: {
  ownerId: string;
  account: Extract<Account, { status: "signed-in" }>;
  api: Api | null;
  page: Exclude<ProfilePage, "settings">;
  invitations: ReturnType<typeof useInvites>;
  onOpenRun?: (runId: string) => void;
  onJoinInvite?: (token: string) => Promise<void>;
  /** Whether this deployment offers servers at all; Servers renders its own notice from it. */
  serversAvailability: ServerAvailability;
  onRetryPlan: () => void;
}) {
  const sync = useSync();
  const live = useRef(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [licenses, setLicenses] = useState<StoredLicense[]>([]);
  const [packs, setPacks] = useState<StoredPack[]>([]);
  const [runs, setRuns] = useState<StoredRun[]>([]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!isOwner(whoSoFar(), ownerId)) return;
    const [nextLicenses, nextPacks, nextRuns] = await Promise.all([listLicenses(), listPacks(), listRuns()]);
    if (!live.current || !isOwner(whoSoFar(), ownerId)) return;
    setLicenses(nextLicenses.filter((license) => !license.deletedAt && license.key));
    setPacks(nextPacks);
    setRuns(nextRuns.filter((run) => !run.deletedAt));
  }, [ownerId]);

  useEffect(() => {
    let active = true;
    const settled = whoSoFar();
    let stopWaiting = () => {};
    if (isOwner(settled, ownerId)) void reload();
    else if (settled === null) {
      void whoAmI().then((who) => {
        if (active && isOwner(who, ownerId)) void reload();
      });
    } else {
      stopWaiting = onWhoChanged((who) => {
        if (active && isOwner(who, ownerId)) void reload();
      });
    }
    const stopSync = syncBus.subscribe((news) => {
      if (news.t === "pulled") void reload();
    });
    return () => {
      active = false;
      stopWaiting();
      stopSync();
    };
  }, [ownerId, reload]);

  useEffect(() => {
    if (!api) return;
    let active = true;
    const { user } = account;
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
    void api
      .putProfile({ ...(name ? { name } : {}), ...(user.email ? { email: user.email } : {}) })
      .then((nextProfile) => {
        if (!active || !live.current) return;
        setProfile(nextProfile);
        rememberProfile(nextProfile);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, account]);

  const syncedPacks = packs.filter((pack) => pack.sync && !pack.sealed).length;
  const runsInAccount = runs.filter((run) => typeof run.seq === "number").length;
  const titleOf = (license: StoredLicense) => packs.find((pack) => pack.id === license.packId)?.title ?? license.title ?? license.packId;

  const deleteEverything = async () => {
    if (!api) return;
    await api.deleteMe();
    if (!live.current || !isOwner(whoSoFar(), ownerId)) return;
    for (const state of await listSyncState()) {
      if (!live.current || !isOwner(whoSoFar(), ownerId)) return;
      await forgetSyncState(state.id);
    }
    if (!live.current || !isOwner(whoSoFar(), ownerId)) return;
    sync.setEnabled(false);
    setProfile(null);
  };

  if (page === "profile") {
    return (
      <ProfilePage
        user={account.user}
        api={api}
        profile={profile}
        sync={sync}
        runsHere={runs.length}
        runsThere={runsInAccount}
        packsHere={packs.length}
        packsThere={syncedPacks}
        licensesHere={licenses.length}
        onSaved={(nextProfile) => {
          if (!live.current) return;
          setProfile(nextProfile);
          rememberProfile(nextProfile, false);
        }}
      />
    );
  }
  if (page === "publishing") return <PublishingPage api={api} />;
  if (page === "developer") return <DeveloperKeysPage api={api} />;
  if (page === "account") {
    return (
      <AccountPage
        api={api}
        licenses={licenses}
        titleOf={titleOf}
        onForgetLicense={async (packId) => {
          if (!isOwner(whoSoFar(), ownerId)) return;
          await forgetLicense(packId);
          if (!live.current || !isOwner(whoSoFar(), ownerId)) return;
          syncBus.localChange("license", packId);
          await reload();
        }}
        onDeleteEverything={deleteEverything}
        onSignOut={account.signOut}
      />
    );
  }
  if (page === "social") {
    return <SocialPage api={api} runs={runs} onOpenRun={onOpenRun} onJoinInvite={onJoinInvite} invitations={invitations} />;
  }
  return <ServersPage api={api} shelf={packs} availability={serversAvailability} onRetryPlan={onRetryPlan} />;
}

/**
 * The names, a sticky rail past 860px and a row of chips under it. Servers
 * is named only for an account the tier is open to, or when it is the
 * page being shown (a claim code lands there whoever follows it).
 */
function ProfileNav({
  page,
  pages,
  onNavigate,
  waiting,
  application = false,
}: {
  page: ProfilePage;
  pages: readonly ProfilePageDescriptor[];
  onNavigate?: (page: ProfilePage, how?: "push" | "replace") => void;
  waiting: number;
  application?: boolean;
}) {
  return (
    <nav className={`profileNav${application ? " profileApplicationNav" : ""}`} aria-label="Profile pages">
      {pages.map((p) => (
        <a
          key={p.id}
          href={profileHash(p.id)}
          className={`chip pick${p.id === page ? " on" : ""}`}
          aria-current={p.id === page ? "page" : undefined}
          onClick={(e) => {
            if (!onNavigate) return;
            e.preventDefault();
            onNavigate(p.id);
          }}
        >
          {p.label}
          {p.id === "social" && waiting > 0 && (
            <span className="menuBadge" title={`${waiting} invitation${waiting === 1 ? "" : "s"} waiting`}>
              {waiting}
            </span>
          )}
        </a>
      ))}
    </nav>
  );
}

/**
 * Who the account is: the name, the linked email, when it was first and
 * last seen here, an id worth copying rather than reading, and how this
 * device's counts of runs, packs and license keys compare with the
 * account's. A picture has no control yet, only the room it will sit in.
 */
function ProfilePage({
  user,
  api,
  profile,
  sync,
  runsHere,
  runsThere,
  packsHere,
  packsThere,
  licensesHere,
  onSaved,
}: {
  user: Extract<Account, { status: "signed-in" }>["user"];
  api: Api | null;
  profile: Profile | null;
  sync: Sync;
  runsHere: number;
  runsThere: number;
  packsHere: number;
  packsThere: number;
  licensesHere: number;
  onSaved: (p: Profile) => void;
}) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
  return (
    <div className="profile profileApplication">
      <h2>Profile</h2>
      <section className="panel">
        <div className="row profileIdentity">
          <div className="avatarSlot" aria-hidden="true" />
          <div className="profileIdentityMain">
            <strong>{name}</strong>
            {user.email && name !== user.email && <div className="muted small">{user.email}</div>}
            <ShownAs api={api} profile={profile} onSaved={onSaved} />
            <p className="muted small">
              Signed in through WorkOS. The app never sees a password.
              {profile && (
                <>
                  {" "}
                  First seen here {onDay(profile.createdAt)}
                  {profile.lastSeenAt !== profile.createdAt && `, last ${onDay(profile.lastSeenAt)}`}.
                </>
              )}
            </p>
            <CopyId id={user.id} />
          </div>
        </div>
      </section>

      <section className="panel">
        <h3 className="sectionTitle">
          Sync <span className="muted">this device</span>
        </h3>
        {sync.available ? (
          <>
            <label className="syncSwitch">
              <input type="checkbox" checked={sync.enabled} onChange={(e) => sync.setEnabled(e.target.checked)} />
              <span>Sync runs on this device</span>
            </label>
            <p className="muted small">
              {sync.enabled
                ? sync.last
                  ? `Last synced ${onDay(sync.last.at)}: ${sync.last.pushed} sent, ${sync.last.pulled} received.`
                  : "Waiting for the first pass."
                : "Off. Nothing on this device goes to your account until you switch it on."}
            </p>
          </>
        ) : (
          <p className="muted small">Sync is not available on this address.</p>
        )}
        <SyncTable runsHere={runsHere} runsThere={runsThere} packsHere={packsHere} packsThere={packsThere} licensesHere={licensesHere} />
        {sync.available && sync.enabled && (
          <button className="ghost tiny" onClick={sync.syncNow} disabled={sync.status === "syncing"}>
            Sync now
          </button>
        )}
      </section>
    </div>
  );
}

/**
 * On this device, in the account, for each of the three things sync
 * carries. A license is small enough that it is always pushed right away,
 * so the same figure stands in both columns for it; a run only earns its
 * "in your account" figure once the server has numbered an event for it,
 * which is what a bare `seq` on the stored record means. When this device
 * holds more runs than that, the row is tinted: something here has not
 * reached the account yet.
 */
function SyncTable({
  runsHere,
  runsThere,
  packsHere,
  packsThere,
  licensesHere,
}: {
  runsHere: number;
  runsThere: number;
  packsHere: number;
  packsThere: number;
  licensesHere: number;
}) {
  const runsBehind = runsHere > runsThere;
  return (
    <table className="syncTable">
      <thead>
        <tr>
          <th scope="col"></th>
          <th scope="col">On this device</th>
          <th scope="col">In your account</th>
        </tr>
      </thead>
      <tbody>
        <tr className={runsBehind ? "behind" : undefined}>
          <th scope="row">Runs</th>
          <td>{runsHere}</td>
          <td>{runsThere}</td>
        </tr>
        <tr>
          <th scope="row">Packs</th>
          <td>{packsHere}</td>
          <td>{packsThere}</td>
        </tr>
        <tr>
          <th scope="row">License keys</th>
          <td>{licensesHere}</td>
          <td>{licensesHere}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Copies the account id on request, rather than leaving it sitting on screen for anyone to read over a shoulder. */
function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="ghost tiny mono"
      data-account-id={id}
      onClick={() => {
        void navigator.clipboard?.writeText(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : "Copy account id"}
    </button>
  );
}

/** What the account sells: its publisher organization and marketplace listings. */
function PublishingPage({ api }: { api: Api | null }) {
  return (
    <div className="profile profileApplication">
      <h2>Publishing</h2>
      <PublisherSection api={api} />
    </div>
  );
}

/**
 * What the account pays for and holds: the plan, what it bought, the keys
 * that opened a sealed copy, and the two ways out: a copy of everything,
 * or the end of it.
 */
function AccountPage({
  api,
  licenses,
  titleOf,
  onForgetLicense,
  onDeleteEverything,
  onSignOut,
}: {
  api: Api | null;
  licenses: StoredLicense[];
  titleOf: (l: StoredLicense) => string;
  onForgetLicense: (packId: string) => Promise<void>;
  onDeleteEverything: () => Promise<void>;
  onSignOut: () => void;
}) {
  return (
    <div className="profile">
      <h2>Account</h2>
      <PlanSection api={api} />
      <PurchasesSection api={api} />

      <section className="panel">
        <h3 className="sectionTitle">
          License keys <span className="muted">sealed copies you have opened</span>
        </h3>
        {licenses.length === 0 ? (
          <p className="muted small">
            None yet. Open a sealed copy and the key you type is kept here, so the same file opens on your other devices without the
            receipt.
          </p>
        ) : (
          licenses.map((l) => <LicenseRow key={l.packId} license={l} title={titleOf(l)} onForget={() => onForgetLicense(l.packId)} />)
        )}
      </section>

      <section className="panel dataActions">
        <h3 className="sectionTitle">
          Your data on the server <span className="muted">a copy of it, or the end of it</span>
        </h3>
        <p className="muted small">
          Everything your account holds, runs, the packs you switched on, license keys, purchases, races, the people you have played with,
          and this profile, can be downloaded as one file, or removed from the server at once. What is on this device stays on this device
          either way.
        </p>
        <DataExport disabled={!api} onExport={async () => (api ? api.exportMe() : Promise.reject(new Error("no API")))} />
        <ServerDelete disabled={!api} onConfirm={onDeleteEverything} />
      </section>

      <section className="panel">
        <h3 className="sectionTitle">Sign out</h3>
        <p className="muted small">Ends this device's session. Nothing here or in your account is touched.</p>
        <button className="ghost" onClick={onSignOut}>
          Sign out
        </button>
      </section>
    </div>
  );
}

/**
 * Who plays with this account: a friend invited to Runlog itself, the run
 * invitations waiting for an answer, the runs that are not solitary any
 * more, and everyone this account has shared a session with.
 */
function SocialPage({
  api,
  runs,
  onOpenRun,
  onJoinInvite,
  invitations,
}: {
  api: Api | null;
  runs: StoredRun[];
  onOpenRun?: (runId: string) => void;
  onJoinInvite?: (token: string) => Promise<void>;
  invitations: ReturnType<typeof useInvites>;
}) {
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const openRuns = runs
    .filter((run) => (run.members?.length ?? 0) > 1 || Boolean(liveLinkOf(run.runId)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.people().then(
      (nextPeople) => live && setPeople(nextPeople),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api]);

  const act = async (token: string, what: "join" | "decline") => {
    setBusyToken(token);
    try {
      if (what === "join") await onJoinInvite?.(token);
      else await api?.declineInvite(token);
      invitations.forget(token);
    } finally {
      setBusyToken(null);
    }
  };

  return (
    <div className="profile profileApplication">
      <h2>Social</h2>
      <ConnectionsSection api={api} />
      <InviteFriend api={api} />

      {invitations.invites.length > 0 && (
        <section className="panel">
          <h3 className="sectionTitle">
            Invitations <span className="muted">people asking you to their table</span>
          </h3>
          <ul className="inviteList" aria-label="Invitations waiting for you">
            {invitations.invites.map((invite) => {
              const busy = busyToken === invite.token;
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
                    <button
                      className="primary tiny"
                      disabled={busy || !onJoinInvite}
                      aria-busy={busy || undefined}
                      onClick={() => void act(invite.token, "join")}
                    >
                      {invite.alreadyIn ? "Open" : "Join"}
                    </button>
                    <button className="ghost tiny" disabled={busy} onClick={() => void act(invite.token, "decline")}>
                      Decline
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="panel">
        <h3 className="sectionTitle">
          Open tables <span className="muted">runs with other people, or a live link</span>
        </h3>
        {openRuns.length === 0 ? (
          <p className="muted small">None yet. A run opens up the moment somebody else joins it, or you share a live link.</p>
        ) : (
          openRuns.map((r) => (
            <button key={r.runId} className="row spread memberRow openTableRow" onClick={() => onOpenRun?.(r.runId)}>
              <span>
                <strong>{r.packTitle ?? r.packId}</strong>
                <span className="muted small">
                  {" "}
                  · {(r.members?.length ?? 0) > 1 ? `${r.members!.length} at the table` : "shared by a live link"}
                </span>
              </span>
              <span className="muted small">{onDay(r.updatedAt)}</span>
            </button>
          ))
        )}
      </section>

      <section className="panel">
        <h3 className="sectionTitle">People you have played with</h3>
        {people.length === 0 ? (
          <p className="muted small">Nobody yet. Invite someone to a run, or accept an invitation, and they show up here.</p>
        ) : (
          people.map((p) => (
            <div key={p.sub} className="row spread memberRow">
              <span>
                <strong>{p.name ?? p.email ?? "Somebody"}</strong>
                {p.email && p.name && <span className="muted small"> · {p.email}</span>}
              </span>
              <span className="muted small">last played {onDay(p.lastPlayedAt)}</span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

/**
 * The name everyone else sees. The account's own name comes from WorkOS
 * and is what a table, a race and a reaction show by default; a name
 * chosen here wins over it, and an address is never shown to anyone but
 * its owner.
 */
function ShownAs({
  api,
  profile,
  onSaved,
}: {
  api: ReturnType<typeof createApi> | null;
  profile: Profile | null;
  onSaved: (p: Profile) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!api || !profile) return null;
  const value = draft ?? profile.handle ?? "";
  const changed = value.trim() !== (profile.handle ?? "");
  return (
    <div className="shownAs">
      <label className="inviteForm">
        <span className="muted small">Shown as</span>
        <input
          className="textInput"
          value={value}
          placeholder={profile.name || "a name for the table"}
          maxLength={24}
          aria-label="The name others see"
          onChange={(e) => {
            setDraft(e.target.value);
            setNote(null);
          }}
        />
        <button
          className="ghost tiny"
          disabled={!changed || busy}
          onClick={() => {
            setBusy(true);
            void api
              .putProfile({ handle: value.trim() })
              .then((p) => {
                onSaved(p);
                setDraft(null);
                setNote(p.handle ? `Others see you as ${p.handle}.` : `Others see you as ${p.name ?? "your account's name"}.`);
              })
              .catch((error: unknown) => {
                if (error instanceof SyncError && error.kind === "conflict") setNote("That name is taken.");
                else setNote(error instanceof Error && error.message ? error.message : "That name was not kept.");
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </label>
      <p className="muted small">
        {note ??
          "What people at a table, in a race, or watching a live link see. Blank shows the name on your account; your address is never shown."}
      </p>
    </div>
  );
}

function onDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * One address, one mail: an invitation to Runlog itself, sent by WorkOS,
 * which lands them at the door signed up. Nothing else is sent to it.
 */
function InviteFriend({ api }: { api: Api | null }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [sent, setSent] = useState<PublisherInvitation[]>([]);
  const refresh = useCallback(() => {
    if (api) void api.myInvitations().then(setSent, () => {});
  }, [api]);
  useEffect(refresh, [refresh]);
  if (!api) return null;
  const send = async () => {
    setBusy(true);
    setNote(null);
    try {
      const out = await api.inviteFriend(email.trim());
      setNote(
        "available" in out ? "Invitations are not switched on here." : `Invited ${out.email}. They get one mail, with a link to sign up.`,
      );
      if (!("available" in out)) setEmail("");
      refresh();
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "The invitation could not be sent.");
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    setBusy(true);
    try {
      await api.revokeFriendInvitation(id);
      refresh();
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "That could not be done just now.");
    } finally {
      setBusy(false);
    }
  };
  const said = (i: PublisherInvitation) =>
    i.state === "accepted"
      ? `joined${i.acceptedAt ? ` ${i.acceptedAt.slice(0, 10)}` : ""}`
      : i.state === "pending"
        ? `invited · until ${i.expiresAt.slice(0, 10)}`
        : i.state;
  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Invite a friend <span className="muted">to Runlog</span>
      </h3>
      <div className="inviteForm">
        <input
          className="textInput"
          type="email"
          placeholder="their email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && email.includes("@") && void send()}
          aria-label="Email address to invite"
        />
        <button className="ghost tiny" disabled={busy || !email.includes("@")} onClick={() => void send()}>
          {busy ? "Sending…" : "Invite"}
        </button>
      </div>
      <p className="muted small">One mail, with a link to sign up. Nothing else is ever sent to the address.</p>
      {note && <p className="muted small">{note}</p>}
      {sent.length > 0 && (
        <div className="publisherPacks">
          {sent.map((i) => (
            <div key={i.id} className="row spread memberRow publisherPack">
              <span>
                <strong>{i.email}</strong>
                <span className="muted small"> · {said(i)}</span>
              </span>
              <span className="row">
                {i.state === "pending" && (
                  <button className="ghost tiny" disabled={busy} onClick={() => void revoke(i.id)}>
                    Take back
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * This device's settings, as a page rather than only as a dialog.
 *
 * The same pane a run's settings opens on, which is the point: somebody
 * who is not in a run had nowhere to turn the sounds off, and somebody
 * who is should not have to leave one to do it. It reads and writes this
 * device's own storage, so the two are two views of one thing rather than
 * two states to keep in step.
 *
 * No `rolling`, because there is no run here. "Roll for me" then means
 * what it says on the tin: the default the next run starts with.
 *
 * The setups somebody keeps are under it, as their own section rather
 * than inside `DeviceSettings`: that pane is also the first tab of a
 * run's settings, and it is device preferences only. Keeping a setup is
 * managing a document, which is what this page is for.
 */
function SettingsPage() {
  const [alerts, setAlerts] = useAlertSettings();
  return (
    <div className="profile profileApplication">
      <section className="panel">
        <h3 className="sectionTitle">
          This device <span className="muted">kept here, not in your account</span>
        </h3>
        <p className="muted small">The theme is in the account menu, where it can be tried and put back without opening anything.</p>
        <DeviceSettings alerts={alerts} onAlerts={setAlerts} />
      </section>
      <SetupsSection />
    </div>
  );
}
