import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, type Account } from "../auth/Account.tsx";
import { useSync, type Sync } from "../sync/SyncProvider.tsx";
import {
  createApi,
  type Api,
  type ApiKey,
  type Claim,
  type KeyScope,
  type Person,
  type Profile,
  type PublisherInvitation,
  type PublisherView,
} from "../sync/client.ts";
import { apiBase } from "../sync/config.ts";
import { syncBus } from "../sync/bus.ts";
import { rememberProfile } from "../sync/useProfile.ts";
import { useInvites } from "../share/useInvites.ts";
import { liveLinkOf } from "../live/route.ts";
import { PROFILE_PAGES, profileHash, type ProfilePage } from "./route.ts";
import { ConnectionsSection } from "../connections/ConnectionsSection.tsx";
import { PlanSection } from "./PlanSection.tsx";
import { PublisherSection } from "./PublisherSection.tsx";
import { PurchasesSection } from "./PurchasesSection.tsx";
import { ServersPage } from "./ServersPage.tsx";
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
  /** Moves between pages — wired to the address bar by the caller. */
  onNavigate?: (page: ProfilePage) => void;
  /** Opens a run from Social's "Open tables": the library's own way in. */
  onOpenRun?: (runId: string) => void;
  /** Accepts an invitation from Social's list and opens the run it is for. */
  onJoinInvite?: (token: string) => Promise<void>;
}

export function ProfileView({ onBack, page = "profile", onNavigate, onOpenRun, onJoinInvite }: ProfileViewProps) {
  const account = useAccount();
  const sync = useSync();
  const base = apiBase();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [licenses, setLicenses] = useState<StoredLicense[]>([]);
  const [packs, setPacks] = useState<StoredPack[]>([]);
  const [runs, setRuns] = useState<StoredRun[]>([]);

  const reload = () => {
    void listLicenses().then((all) => setLicenses(all.filter((l) => !l.deletedAt && l.key)));
    void listPacks().then(setPacks);
    void listRuns().then((all) => setRuns(all.filter((r) => !r.deletedAt)));
  };

  useEffect(() => {
    reload();
    return syncBus.subscribe((news) => {
      if (news.t === "pulled") reload();
    });
  }, []);

  const api = useMemo(
    () => (base && account.status === "signed-in" ? createApi(base, account.getAccessToken) : null),
    [base, account],
  );

  // The visit is the profile's heartbeat, and the name and email travel
  // with it so the row is never older than the last time the page was
  // opened. WorkOS stays the truth; this is the snapshot.
  useEffect(() => {
    if (!api || account.status !== "signed-in") return;
    let live = true;
    const { user } = account;
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
    void api
      .putProfile({ ...(name ? { name } : {}), ...(user.email ? { email: user.email } : {}) })
      .then((p) => {
        if (!live) return;
        setProfile(p);
        rememberProfile(p);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, account]);

  // Read once here so the nav's badge and the Social page agree, rather
  // than each polling the server on its own.
  const invitations = useInvites(api, true);

  if (account.status !== "signed-in") {
    return (
      <main className="main">
        <section className="panel setup profile">
          <h2>Your account</h2>
          <p className="muted">
            {account.status === "local"
              ? "This copy of the app has nothing to sign into. Everything you do stays on this machine."
              : "Sign in to see your account, your license keys, and what sync has carried."}
          </p>
          <div className="padRow">
            {account.status !== "local" && (
              <button className="primary" onClick={account.signIn}>
                Sign in
              </button>
            )}
            <button className="ghost" onClick={onBack}>
              Back to the game
            </button>
          </div>
        </section>
      </main>
    );
  }

  const { user } = account;
  const syncedPacks = packs.filter((p) => p.sync && !p.sealed).length;
  const runsInAccount = runs.filter((r) => typeof r.seq === "number").length;
  const titleOf = (l: StoredLicense) => packs.find((p) => p.id === l.packId)?.title ?? l.title ?? l.packId;

  const deleteEverything = async () => {
    if (!api) return;
    await api.deleteMe();
    // The server has nothing now, so nothing is "already sent": the next
    // pass would push everything again, which is not what somebody who
    // just did this wants. Sync goes off with it.
    for (const s of await listSyncState()) await forgetSyncState(s.id);
    sync.setEnabled(false);
    setProfile(null);
  };

  return (
    <main className="main">
      <div className="profileLayout">
        <ProfileNav page={page} onNavigate={onNavigate} waiting={invitations.invites.length} />
        <div className="profileBody">
          {page === "profile" && (
            <ProfilePage
              user={user}
              api={api}
              profile={profile}
              sync={sync}
              runsHere={runs.length}
              runsThere={runsInAccount}
              packsHere={packs.length}
              packsThere={syncedPacks}
              licensesHere={licenses.length}
              onSaved={(p) => {
                setProfile(p);
                rememberProfile(p);
              }}
            />
          )}
          {page === "publishing" && <PublishingPage api={api} />}
          {page === "account" && (
            <AccountPage
              api={api}
              licenses={licenses}
              titleOf={titleOf}
              onForgetLicense={async (packId) => {
                await forgetLicense(packId);
                syncBus.localChange("license", packId);
                reload();
              }}
              onDeleteEverything={deleteEverything}
              onSignOut={account.signOut}
            />
          )}
          {page === "social" && <SocialPage api={api} onOpenRun={onOpenRun} onJoinInvite={onJoinInvite} invitations={invitations} />}
          {page === "servers" && <ServersPage api={api} />}
        </div>
      </div>
    </main>
  );
}

/** The four names, a sticky rail past 860px and a row of chips under it. */
function ProfileNav({ page, onNavigate, waiting }: { page: ProfilePage; onNavigate?: (page: ProfilePage) => void; waiting: number }) {
  return (
    <nav className="profileNav" aria-label="Profile pages">
      {PROFILE_PAGES.map((p) => (
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
    <div className="profile">
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

/**
 * What the account sells, and the keys that stand for it: publishing, CLI
 * keys and signing keys claimed. Someone who is not a publisher and has
 * made neither kind of key sees one paragraph and a way to start, rather
 * than three empty tables.
 */
function PublishingPage({ api }: { api: Api | null }) {
  const [publisher, setPublisher] = useState<PublisherView | null | undefined>(undefined);
  const [keys, setKeys] = useState<ApiKey[] | undefined>(undefined);
  const [claims, setClaims] = useState<Claim[] | undefined>(undefined);

  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.myPublisher().then(
      (p) => live && setPublisher(p),
      () => live && setPublisher(null),
    );
    void api.listKeys().then(
      (k) => live && setKeys(k),
      () => live && setKeys([]),
    );
    void api.listClaims().then(
      (c) => live && setClaims(c),
      () => live && setClaims([]),
    );
    return () => {
      live = false;
    };
  }, [api]);

  // Without an API there is nothing to read and nothing to do: that is the
  // same "nothing here yet" state as a signed-in account that simply
  // hasn't started, not a spinner stuck forever.
  const noApi = !api;
  const loading = !noApi && (publisher === undefined || keys === undefined || claims === undefined);
  const empty = noApi || (!loading && !publisher && (keys?.length ?? 0) === 0 && (claims?.length ?? 0) === 0);

  return (
    <div className="profile">
      <h2>Publishing</h2>
      {loading ? null : empty ? (
        <section className="panel">
          <p className="muted small">
            This is where a publisher lives: who else is in it, what you have listed for sale and what it has
            earned, hosted licensing, and the command-line keys and signing keys tied to your account. Write a pack
            first, in the <a href="#create">Designer</a>.
          </p>
        </section>
      ) : (
        <>
          <PublisherSection api={api} />
          <CommandLine api={api} />
        </>
      )}
    </div>
  );
}

/**
 * What the account pays for and holds: the plan, what it bought, the keys
 * that opened a sealed copy, and the two ways out — a copy of everything,
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
            None yet. Open a sealed copy and the key you type is kept here, so the same file opens on your other
            devices without the receipt.
          </p>
        ) : (
          licenses.map((l) => (
            <LicenseRow key={l.packId} license={l} title={titleOf(l)} onForget={() => onForgetLicense(l.packId)} />
          ))
        )}
      </section>

      <section className="panel">
        <h3 className="sectionTitle">
          Your data on the server <span className="muted">a copy of it, or the end of it</span>
        </h3>
        <p className="muted small">
          Everything your account holds — runs, the packs you switched on, license keys, purchases, races, the people you
          have played with, and this profile — can be downloaded as one file, or removed from the server at once. What is on
          this device stays on this device either way.
        </p>
        <Export disabled={!api} onExport={async () => (api ? api.exportMe() : Promise.reject(new Error("no API")))} />
        <Forget disabled={!api} onConfirm={onDeleteEverything} />
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
  onOpenRun,
  onJoinInvite,
  invitations,
}: {
  api: Api | null;
  onOpenRun?: (runId: string) => void;
  onJoinInvite?: (token: string) => Promise<void>;
  invitations: ReturnType<typeof useInvites>;
}) {
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [openRuns, setOpenRuns] = useState<StoredRun[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => {
    void listRuns().then((all) =>
      setOpenRuns(
        all
          .filter((r) => !r.deletedAt && ((r.members?.length ?? 0) > 1 || Boolean(liveLinkOf(r.runId))))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      ),
    );
  }, []);

  useEffect(() => {
    if (api) void api.people().then(setPeople, () => {});
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
    <div className="profile">
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
                    <button className="primary tiny" disabled={busy || !onJoinInvite} aria-busy={busy || undefined} onClick={() => void act(invite.token, "join")}>
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
                <span className="muted small"> · {(r.members?.length ?? 0) > 1 ? `${r.members!.length} at the table` : "shared by a live link"}</span>
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
function ShownAs({ api, profile, onSaved }: { api: ReturnType<typeof createApi> | null; profile: Profile | null; onSaved: (p: Profile) => void }) {
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
              .catch((error: unknown) => setNote(error instanceof Error && error.message ? error.message : "That name was not kept."))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </label>
      <p className="muted small">{note ?? "What people at a table, in a race, or watching a live link see. Blank shows the name on your account; your address is never shown."}</p>
    </div>
  );
}

/**
 * The command line, as you. On your own machine `runlog login` signs in
 * through the browser and needs nothing from here; the keys made here are
 * for a machine with nobody at it — CI publishing a release — shown once.
 * Below them, the signing keys the account has claimed, which is what puts
 * your name beside a signature in the app.
 */
function CommandLine({ api }: { api: Api | null }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<KeyScope>("release");
  const [fresh, setFresh] = useState<{ name: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    if (!api) return;
    void api.listKeys().then(setKeys, () => {});
    void api.listClaims().then(setClaims, () => {});
  };
  useEffect(refresh, [api]);

  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Command line <span className="muted">keys for CI, and the signing keys you have claimed</span>
      </h3>
      {!api && <p className="muted small">Sign in on a hosted address to make a key for the command line.</p>}
      {api && (
        <p className="muted small">
          On your own computer, <code>npx @scrthq/runlog login</code> signs in through this browser and needs no key. A key is for a machine with
          nobody at it, such as CI publishing a release: set it as <code>RUNLOG_API_KEY</code> there. A key that only releases can check,
          sign, publish and release packs and nothing else, so a leaked build secret cannot reach your runs, your sales or your people.
        </p>
      )}
      {api && (
        <>
          {keys.map((k) => (
            <div key={k.id} className="row spread memberRow">
              <span>
                <strong>{k.name}</strong>
                <span className="muted small mono"> {k.prefix}…</span>
                {k.scope === "release" && <span className="chip state">releases only</span>}
                <span className="muted small"> · made {onDay(k.createdAt)}{k.lastUsedAt ? `, used ${onDay(k.lastUsedAt)}` : ", never used"}</span>
              </span>
              <button className="ghost tiny" onClick={() => void api.revokeKey(k.id).then(refresh, () => {})}>
                Revoke
              </button>
            </div>
          ))}
          {fresh ? (
            <div className="freshKey">
              <p className="small">
                <strong>{fresh.name}</strong>: copy it now. It is not shown again.
              </p>
              <div className="licenseKey mono">{fresh.secret}</div>
              <div className="padRow">
                <button
                  className="primary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(fresh.secret);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
                <button className="ghost" onClick={() => setFresh(null)}>
                  Done
                </button>
              </div>
              <p className="muted small">
                In CI, set it as <code>RUNLOG_API_KEY</code>. On a machine you sit at, <code>npx @scrthq/runlog login --key</code> and paste it.
              </p>
            </div>
          ) : (
            <div className="inviteForm">
              <input
                className="textInput"
                placeholder="what this key is for, e.g. laptop"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Name for the new key"
              />
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as KeyScope)}
                aria-label="What the new key may do"
                title="A release key checks, signs, publishes and releases packs, and nothing else: the one to leave in a build server's secrets. A full key is you on every route."
              >
                <option value="release">Releases only</option>
                <option value="full">Everything</option>
              </select>
              <button
                className="primary"
                disabled={!name.trim() || busy}
                onClick={() => {
                  setBusy(true);
                  void api
                    .createKey(name.trim(), scope)
                    .then(({ key, secret }) => {
                      setFresh({ name: key.name, secret });
                      setName("");
                      refresh();
                    })
                    .catch(() => {})
                    .finally(() => setBusy(false));
                }}
              >
                {busy ? "Making…" : "Make a key"}
              </button>
            </div>
          )}

          <h4 className="stepLabel">Signing keys you have claimed</h4>
          {claims.length === 0 ? (
            <p className="muted small">
              None yet. <code>npx @scrthq/runlog claim key.json</code> proves a signing key is yours; packs signed with it then show your
              name.
            </p>
          ) : (
            claims.map((c) => (
              <div key={c.fingerprint} className="row spread memberRow">
                <span className="mono small">{c.fingerprint}</span>
                <button className="ghost tiny" onClick={() => void api.removeClaim(c.fingerprint).then(refresh, () => {})}>
                  Remove
                </button>
              </div>
            ))
          )}
        </>
      )}
    </section>
  );
}

/**
 * One key. Hidden by default because this page can be open on a shared
 * screen; shown or copied on purpose. Forgetting takes two presses, since a
 * key is the receipt for something paid for.
 */
function LicenseRow({
  license,
  title,
  onForget,
}: {
  license: StoredLicense;
  title: string;
  onForget: () => Promise<void>;
}) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [arming, setArming] = useState(false);
  const masked = license.key.replace(/[A-Z0-9](?=.{5})/gi, "•");
  return (
    <div className="row licenseRow">
      <div className="licenseMain">
        <strong>{title}</strong>
        {license.ref && <div className="muted small mono">order {license.ref}</div>}
        <div className="licenseKey mono">{shown ? license.key : masked}</div>
      </div>
      <div className="licenseActions">
        <button className="ghost tiny" onClick={() => setShown((s) => !s)}>
          {shown ? "Hide" : "Show"}
        </button>
        <button
          className="ghost tiny"
          onClick={() => {
            void navigator.clipboard?.writeText(license.key);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {arming ? (
          <>
            <button className="ghost tiny danger" onClick={() => void onForget()}>
              Forget it
            </button>
            <button className="ghost tiny" onClick={() => setArming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="ghost tiny" title="Remove this key from your account and this device" onClick={() => setArming(true)}>
            Forget
          </button>
        )}
      </div>
    </div>
  );
}

/** The copy: one button, then the file, then a word on how big it was. */
function Export({ disabled, onExport }: { disabled: boolean; onExport: () => Promise<{ url: string; bytes: number }> }) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "done"; bytes: number } | { kind: "failed"; why: string }>({ kind: "idle" });
  return (
    <div className="padRow">
      <button
        className="ghost"
        disabled={disabled || state.kind === "busy"}
        aria-busy={state.kind === "busy" || undefined}
        onClick={() => {
          setState({ kind: "busy" });
          onExport().then(
            ({ url, bytes }) => {
              setState({ kind: "done", bytes });
              location.assign(url);
            },
            (error: unknown) => setState({ kind: "failed", why: error instanceof Error && error.message ? error.message : "the export could not be made" }),
          );
        }}
      >
        {state.kind === "busy" ? "Gathering…" : "Download everything"}
      </button>
      {state.kind === "done" && <span className="muted small">{Math.max(1, Math.round(state.bytes / 1024))} KB, as JSON. The link works for fifteen minutes.</span>}
      {state.kind === "failed" && <span className="muted small">{state.why}</span>}
    </div>
  );
}

function Forget({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => Promise<void> }) {
  const [state, setState] = useState<"idle" | "arming" | "busy" | "done" | "failed">("idle");
  if (state === "done") return <p className="muted small">Done. The server holds nothing of yours now.</p>;
  if (state === "arming") {
    return (
      <div className="padRow">
        <button
          className="ghost danger"
          onClick={() => {
            setState("busy");
            onConfirm().then(
              () => setState("done"),
              () => setState("failed"),
            );
          }}
        >
          Yes, delete everything of mine on the server
        </button>
        <button className="ghost" onClick={() => setState("idle")}>
          Keep it
        </button>
      </div>
    );
  }
  return (
    <div className="padRow">
      <button className="ghost danger" disabled={disabled || state === "busy"} onClick={() => setState("arming")}>
        {state === "busy" ? "Deleting…" : "Delete everything of mine on the server"}
      </button>
      {state === "failed" && <span className="warnText small">That did not go through. Try again in a moment.</span>}
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
      setNote("available" in out ? "Invitations are not switched on here." : `Invited ${out.email}. They get one mail, with a link to sign up.`);
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
    i.state === "accepted" ? `joined${i.acceptedAt ? ` ${i.acceptedAt.slice(0, 10)}` : ""}` : i.state === "pending" ? `invited · until ${i.expiresAt.slice(0, 10)}` : i.state;
  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Invite a friend <span className="muted">to Runlog</span>
      </h3>
      <div className="inviteForm">
        <input className="textInput" type="email" placeholder="their email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && email.includes("@") && void send()} aria-label="Email address to invite" />
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
