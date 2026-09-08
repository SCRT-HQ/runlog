import { useEffect, useState } from "react";
import type { Pack } from "@runlog/rules-schema";
import { useAccount } from "../auth/Account.tsx";
import { useApi } from "../sync/useApi.ts";
import { PlanError, REACTIONS, type Invite, type Person, type Reaction, type SessionMember } from "../sync/client.ts";
import { syncBus } from "../sync/bus.ts";
import { liveLinkOf, rememberLiveLink } from "../live/route.ts";
import { useHosted } from "../hosted/HostedProvider.tsx";
import { useSync } from "../sync/SyncProvider.tsx";
import type { StoredRun } from "../storage/db.ts";

/**
 * Who is at the table, and how to ask someone else.
 *
 * The members come with the run from the server; the invitations and the
 * people list are asked for when the panel opens, since only the owner
 * sees them and they change rarely. Inviting is an address and a role, with
 * the people this account has played with offered as the address is typed.
 * Nothing here is available without an account, and the panel says so
 * rather than showing controls that cannot work.
 */
export function Members({ pack, run }: { pack: Pack; run: StoredRun }) {
  const account = useAccount();
  const api = useApi();
  const hosted = useHosted();
  const sync = useSync();
  const me = account.status === "signed-in" ? account.user.id : null;
  const noun = pack.vocabulary.run.one.toLowerCase();
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const members: SessionMember[] = run.members ?? [];
  const owner = run.role === "owner";

  const [invites, setInvites] = useState<Invite[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"player" | "viewer">("player");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [liveLink, setLiveLink] = useState<string | null>(() => liveLinkOf(run.runId));
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const shared = Boolean(liveLink) || run.shared === true;
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [reactedAt, setReactedAt] = useState(0);

  // What the watchers and the table sent: read when the panel opens, on
  // every pull of this run (the socket rings for a reaction), and every so
  // often.
  useEffect(() => {
    if (!api) return;
    let live = true;
    const read = () => void api.reactions(run.runId).then((r) => live && setReactions(r), () => {});
    read();
    const every = window.setInterval(read, 15_000);
    const off = syncBus.subscribe((news) => {
      if (news.t === "pulled" && news.kind === "run" && news.ids.includes(run.runId)) read();
    });
    return () => {
      live = false;
      window.clearInterval(every);
      off();
    };
  }, [api, shared, run.runId]);

  const refresh = () => {
    if (!api || !owner) return;
    void api.listInvites(run.runId).then(setInvites, () => {});
    void api.people().then(setPeople, () => {});
  };
  useEffect(refresh, [api, owner, run.runId]);

  const heading = (
    <summary>
      <h3 className="sectionTitle">
        People <span className="muted">at the table</span>
      </h3>
    </summary>
  );

  if (!api) {
    return (
      <details className="panel people">
        {heading}
        <div className="peopleBody">
          <p className="muted small">Sign in to share this {noun} with someone.</p>
        </div>
      </details>
    );
  }

  const invite = async () => {
    const to = email.trim();
    if (!to || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await api.createInvite(run.runId, to, role);
      setEmail("");
      setNote(`Sent to ${to}. The link works for seven days.`);
      refresh();
    } catch (error) {
      if (error instanceof PlanError) setUpgrade(error.message);
      else setNote(error instanceof Error && error.message ? error.message : "That did not send. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const pending = invites.filter((i) => !i.accepted);
  const react = (emoji: string) => {
    if (reactedAt > Date.now()) return;
    setReactedAt(Date.now() + 1000);
    void api.react(run.runId, emoji).then(setReactions, () => {});
  };

  /**
   * Where the run stands with the account, said plainly. A run the server
   * has never seen has no role yet; whether it is on its way depends on
   * this device's sync switch, which is the thing to offer.
   */
  const reached = run.role !== undefined;
  const company = members.some((m) => m.sub !== me) || pending.length > 0;

  return (
    <details className="panel people members" open={company}>
      {heading}
      <div className="peopleBody">
      {!reached && sync.available && !sync.enabled && (
        <p className="muted small">
          Sync is off on this device, so this {noun} stays here.{" "}
          <button className="linkButton" onClick={() => sync.setEnabled(true)}>
            Turn sync on
          </button>
        </p>
      )}
      {!reached && (!sync.available || sync.enabled) && (
        <p className="muted small">Reaching your account. Inviting opens once it has.</p>
      )}
      {members.length > 0 && (
        <div className="reactRow tableReact" aria-label="React">
          {REACTIONS.map((emoji) => (
            <button key={emoji} className="reactButton" onClick={() => react(emoji)} title="Send this to everyone at the table and watching">
              {emoji}
            </button>
          ))}
        </div>
      )}
      {members.length > 0 && reactions.length > 0 && (
        <div className="reactRecent" aria-live="polite">
          {[...reactions].reverse().slice(0, 8).map((r, i) => (
            <span key={`${r.at}-${i}`} className="chip reactChip" title={new Date(r.at).toLocaleTimeString()}>
              {r.emoji}
              {r.name ? ` ${r.name}` : ""}
            </span>
          ))}
        </div>
      )}
      {members.map((m) => (
        <div key={m.sub} className={`row spread memberRow${m.sub === me ? " me" : ""}`} aria-current={m.sub === me ? "true" : undefined}>
          <span>
            <strong>{m.name ?? (m.sub === me ? "You" : "Somebody")}</strong>
            <span className="muted small"> · {m.role}</span>
            {m.sub === me && <span className="chip you">you</span>}
          </span>
          {owner && m.role !== "owner" && (
            <button
              className="ghost tiny"
              title="Remove them from this run"
              onClick={() => void api.removeMember(run.runId, m.sub).then(refresh, () => {})}
            >
              Remove
            </button>
          )}
        </div>
      ))}

      {owner && (
        <>
          {pending.length > 0 && (
            <>
              <h4 className="stepLabel">Invited, not yet here</h4>
              {pending.map((i) => (
                <div key={i.token} className="row spread memberRow">
                  <span className="mono small">{i.email}</span>
                  <button className="ghost tiny" onClick={() => void api.revokeInvite(run.runId, i.token).then(refresh, () => {})}>
                    Withdraw
                  </button>
                </div>
              ))}
            </>
          )}
          <h4 className="stepLabel">Invite someone</h4>
          {!pack.license.redistributable && (
            <p className="muted small">This pack is marked not for redistribution, so its text does not travel with the invitation: whoever you invite needs their own copy of the pack to open the run.</p>
          )}
          <div className="inviteForm">
            <input
              className="textInput"
              type="email"
              list="runlog-people"
              placeholder="their email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void invite()}
              aria-label="Email address to invite"
            />
            <datalist id="runlog-people">
              {people.filter((p) => p.email).map((p) => (
                <option key={p.sub} value={p.email!}>
                  {p.name ?? p.email}
                </option>
              ))}
            </datalist>
            <select value={role} onChange={(e) => setRole(e.target.value === "viewer" ? "viewer" : "player")} aria-label="Role">
              <option value="player">plays</option>
              <option value="viewer">watches</option>
            </select>
            <button className="primary" disabled={!email.trim() || busy} onClick={() => void invite()}>
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
          {note && <p className="muted small">{note}</p>}
          {upgrade && (
            <p className="notice">
              {upgrade}. Subscribe from your profile, under Plan{hosted?.links.pricing ? <>; <a href={hosted.links.pricing}>what each plan has</a></> : null}.
            </p>
          )}
          <p className="muted small">
            They get a link by email, sign in, and the run appears on their devices. A watcher sees every move and makes none.
          </p>

          <h4 className="stepLabel">A live link</h4>
          {shared && liveLink ? (
            <>
              <div className="inviteForm">
                <input className="textInput mono small" readOnly value={liveLink} aria-label="The live link" onFocus={(e) => e.currentTarget.select()} />
                <button
                  className="ghost tiny"
                  onClick={() => {
                    void navigator.clipboard?.writeText(liveLink).then(
                      () => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      },
                      () => {},
                    );
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  className="ghost tiny"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void api
                      .unshareRun(run.runId)
                      .then(() => {
                        rememberLiveLink(run.runId, null);
                        setLiveLink(null);
                        setLiveNote("The link is dead; anyone holding it sees nothing now.");
                      })
                      .catch((error: unknown) => setLiveNote(error instanceof Error && error.message ? error.message : "That could not be done just now."))
                      .finally(() => setBusy(false));
                  }}
                >
                  Stop sharing
                </button>
              </div>
              <p className="muted small">
                Anyone with the link watches this {pack.vocabulary.run.one.toLowerCase()} as it happens, with no account.{" "}
                {pack.license.redistributable ? "They see the whole thing, the pack's paper included." : "The pack's text is not for redistribution, so they see the state and the log by reference, never the rules."}
              </p>
            </>
          ) : (
            <>
              <button
                className="ghost tiny"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setLiveNote(null);
                  void api
                    .shareRun(run.runId)
                    .then(({ link }) => {
                      rememberLiveLink(run.runId, link);
                      setLiveLink(link);
                    })
                    .catch((error: unknown) => {
                      if (error instanceof PlanError) setUpgrade(error.message);
                      else setLiveNote(error instanceof Error && error.message ? error.message : "That could not be done just now.");
                    })
                    .finally(() => setBusy(false));
                }}
              >
                Share a live link
              </button>
              <p className="muted small">A link anyone can open, no account, to watch this {pack.vocabulary.run.one.toLowerCase()} as it happens. You can stop sharing at any time.</p>
            </>
          )}
          {liveNote && <p className="muted small">{liveNote}</p>}
        </>
      )}
      </div>
    </details>
  );
}
