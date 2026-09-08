import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "../auth/Account.tsx";
import { useSync } from "../sync/SyncProvider.tsx";
import { createApi, type ApiKey, type Claim, type KeyScope, type Profile, type PublisherInvitation } from "../sync/client.ts";
import { apiBase } from "../sync/config.ts";
import { syncBus } from "../sync/bus.ts";
import { rememberProfile } from "../sync/useProfile.ts";
import { PlanSection } from "./PlanSection.tsx";
import { PublisherSection } from "./PublisherSection.tsx";
import { PurchasesSection } from "./PurchasesSection.tsx";
import {
  forgetLicense,
  forgetSyncState,
  listLicenses,
  listPacks,
  listRuns,
  listSyncState,
  type StoredLicense,
  type StoredPack,
} from "../storage/db.ts";

/**
 * The person's page.
 *
 * Four things, in the order a player would look for them: who the account
 * is, whether this device syncs and what has gone, the license keys this
 * account holds, and the one destructive thing — telling the server to
 * forget everything. Nothing here is a setting the app needs; it is a
 * receipt for what the account is doing, with the few controls that belong
 * next to it.
 *
 * Everything shown comes from this machine first. The server is asked
 * once, to stamp the visit and hand back the profile row, and if that
 * fails the page is still whole: local runs, local packs, local keys.
 */

export function ProfileView({ onBack }: { onBack: () => void }) {
  const account = useAccount();
  const sync = useSync();
  const base = apiBase();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [licenses, setLicenses] = useState<StoredLicense[]>([]);
  const [packs, setPacks] = useState<StoredPack[]>([]);
  const [runCount, setRunCount] = useState(0);

  const reload = () => {
    void listLicenses().then((all) => setLicenses(all.filter((l) => !l.deletedAt && l.key)));
    void listPacks().then(setPacks);
    void listRuns().then((runs) => setRunCount(runs.filter((r) => !r.deletedAt).length));
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
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
  const syncedPacks = packs.filter((p) => p.sync && !p.sealed).length;
  const titleOf = (l: StoredLicense) => packs.find((p) => p.id === l.packId)?.title ?? l.title ?? l.packId;

  return (
    <main className="main">
      <div className="profile">
        <section className="panel">
          <h3 className="sectionTitle">
            You <span className="muted">the account</span>
          </h3>
          <div className="row spread">
            <div>
              <strong>{name}</strong>
              {user.email && name !== user.email && <div className="muted small">{user.email}</div>}
              <div className="muted small mono">{user.id}</div>
            </div>
            <button className="ghost tiny" onClick={account.signOut}>
              Sign out
            </button>
          </div>
          <ShownAs
            api={api}
            profile={profile}
            onSaved={(p) => {
              setProfile(p);
              rememberProfile(p);
            }}
          />
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
          <div className="profileCounts">
            <Count n={runCount} one="run" many="runs" note="kept here" />
            <Count n={packs.length} one="pack" many="packs" note={`${syncedPacks} in your account`} />
            <Count n={licenses.length} one="license key" many="license keys" note="in your account" />
          </div>
          {sync.available && sync.enabled && (
            <button className="ghost tiny" onClick={sync.syncNow} disabled={sync.status === "syncing"}>
              Sync now
            </button>
          )}
        </section>

        <PlanSection api={api} />

        <PurchasesSection api={api} />

        <PublisherSection api={api} />

        <InviteFriend api={api} />

        <CommandLine api={api} />

        <section className="panel">
          <h3 className="sectionTitle">
            License keys <span className="muted">sealed copies you have opened</span>
          </h3>
          {licenses.length === 0 ? (
            <p className="muted small">
              None yet. Open a sealed copy and the key you type is kept here, so the same file opens on your
              other devices without the receipt.
            </p>
          ) : (
            licenses.map((l) => (
              <LicenseRow
                key={l.packId}
                license={l}
                title={titleOf(l)}
                onForget={async () => {
                  await forgetLicense(l.packId);
                  syncBus.localChange("license", l.packId);
                  reload();
                }}
              />
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
          <Forget
            disabled={!api}
            onConfirm={async () => {
              if (!api) return;
              await api.deleteMe();
              // The server has nothing now, so nothing is "already sent":
              // the next pass would push everything again, which is not what
              // somebody who just did this wants. Sync goes off with it.
              for (const s of await listSyncState()) await forgetSyncState(s.id);
              sync.setEnabled(false);
              setProfile(null);
            }}
          />
        </section>
      </div>
    </main>
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
function CommandLine({ api }: { api: ReturnType<typeof createApi> | null }) {
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

function Count({ n, one, many, note }: { n: number; one: string; many: string; note: string }) {
  return (
    <div className="profileCount">
      <span className="big">{n}</span>
      <span>
        {n === 1 ? one : many}
        <span className="muted small"> · {note}</span>
      </span>
    </div>
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
function InviteFriend({ api }: { api: ReturnType<typeof createApi> | null }) {
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
