import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Pack } from "@runlog/rules-schema";
import { useAccount } from "../auth/Account.tsx";
import { useApi } from "../sync/useApi.ts";
import { PlanError, REACTIONS, type Invite, type Person, type Reaction, type SessionMember } from "../sync/client.ts";
import { syncBus } from "../sync/bus.ts";
import { liveLinkOf, rememberLiveLink } from "../live/route.ts";
import { useHosted } from "../hosted/HostedProvider.tsx";
import { useSync } from "../sync/SyncProvider.tsx";
import type { StoredRun } from "../storage/db.ts";
import { useProfile } from "../sync/useProfile.ts";
import { useReachable } from "./useReachable.ts";
import { controlAddress } from "./controlAddress.ts";
import { isEmpty, type ControlProfile } from "../control/profile.ts";
import type { AttachedTool } from "./useAttachedTools.ts";
import { CheckGlyph, CopyGlyph, DeckGlyph, PlugGlyph, XGlyph } from "./glyphs.tsx";
import { useDismiss } from "../ui/useDismiss.ts";
import { useToast } from "../ui/Toast.tsx";
import { useConfirm } from "../ui/useConfirm.tsx";
import { newKeyQuestion } from "./watchKey.ts";

/**
 * The account behind a connection, as the server names it.
 *
 * A tool dials on a watch key rather than signing in, so its connection
 * is named for the key's owner with a prefix. A deck signs in and is
 * named plainly. Stripping the prefix lets both be held against the
 * member list.
 */
const accountOf = (sub: string) => (sub.startsWith("stream:") ? sub.slice("stream:".length) : sub);

/** One mark in a member's row: what is plugged in, lit or not. */
function ToolIcon({ lit, label, children }: { lit: boolean; label: string; children: ReactNode }) {
  return (
    <span className={`toolIcon ${lit ? "lit" : "dim"}`} role="img" title={label} aria-label={label}>
      {children}
    </span>
  );
}

/**
 * Asking somebody to the table: an address, and what they come as.
 *
 * A sheet rather than a block in the panel, because the panel is a list of
 * who is here and a form pushed the list off the screen. Built the way the
 * settings sheet and the name gate are: a veil, a panel, and the shared
 * dismiss hook for Escape and a press outside.
 */
function InviteDialog({
  people,
  redistributable,
  noun,
  onSend,
  onClose,
}: {
  /** Addresses this account has played with, offered as the address is typed. */
  people: Person[];
  /** Whether the pack travels with the invitation. */
  redistributable: boolean;
  /** What the pack calls a run. */
  noun: string;
  /** Ask the server. It resolves when the invitation went, and rejects with what to say. */
  onSend: (to: string, role: "player" | "viewer") => Promise<void>;
  onClose: () => void;
}) {
  const sheet = useRef<HTMLElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"player" | "viewer">("player");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useDismiss(sheet, true, onClose);
  useEffect(() => {
    field.current?.focus();
  }, []);

  const send = () => {
    const to = email.trim();
    if (!to || busy) return;
    setBusy(true);
    setNote(null);
    void onSend(to, role)
      .then(onClose, (error: unknown) =>
        setNote(error instanceof Error && error.message ? error.message : "That did not send. Try again in a moment."),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="veil" role="presentation">
      <section ref={sheet} className="panel termsGate inviteDialog" role="dialog" aria-modal="true" aria-labelledby="inviteTitle">
        <h2 id="inviteTitle">Invite someone</h2>
        {!redistributable && (
          <p className="muted small">
            This pack is marked not for redistribution, so its text does not travel with the invitation: whoever you invite needs their own
            copy of the pack to open the {noun}.
          </p>
        )}
        <div className="inviteForm">
          <input
            ref={field}
            className="textInput"
            type="email"
            list="runlog-people"
            placeholder="their email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setNote(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && send()}
            aria-label="Email address to invite"
            title="They get a link by email, sign in, and the run appears on their devices. A watcher sees every move and makes none."
          />
          <datalist id="runlog-people">
            {people
              .filter((p) => p.email)
              .map((p) => (
                <option key={p.sub} value={p.email!}>
                  {p.name ?? p.email}
                </option>
              ))}
          </datalist>
          <select value={role} onChange={(e) => setRole(e.target.value === "viewer" ? "viewer" : "player")} aria-label="Role">
            <option value="player">plays</option>
            <option value="viewer">watches</option>
          </select>
        </div>
        {note && <p className="muted small">{note}</p>}
        <div className="padRow">
          <button className="ghost small" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!email.trim() || busy} onClick={send}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * Who is at the table, and how to ask someone else.
 *
 * The members come with the run from the server; the invitations and the
 * people list are asked for when the panel opens, since only the owner
 * sees them and they change rarely. Inviting is an address and a role, with
 * the people this account has played with offered as the address is typed.
 * Nothing here is available without an account, and the panel says so
 * rather than showing controls that cannot work.
 *
 * What is attached comes in as props rather than from the socket here:
 * the run screen is already listening for it, and one listener answering
 * every panel beats three of them counting the same decks.
 */
export function Members({
  pack,
  run,
  tools = [],
  deckSubs = [],
}: {
  pack: Pack;
  run: StoredRun;
  /** The tools on the run's games, as the server last said. */
  tools?: AttachedTool[];
  /** The accounts with a deck on this run. */
  deckSubs?: string[];
}) {
  const account = useAccount();
  const api = useApi();
  const hosted = useHosted();
  const sync = useSync();
  const me = account.status === "signed-in" ? account.user.id : null;
  const noun = pack.vocabulary.run.one.toLowerCase();
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const { profile } = useProfile();
  const reach = useReachable(api, run);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  // Replacing a watch key puts the old one out everywhere, so it is asked
  // for first; see useConfirm.
  const { dialog, ask } = useConfirm();
  const toast = useToast();
  /**
   * A mint in flight.
   *
   * The question closes the moment it is answered and `mint()` runs on
   * past it, so the buttons were live again while the key was still being
   * made. A second press asked again and minted again, putting out the
   * key the first press was in the middle of copying. The state grays the
   * buttons; the ref holds the line for a press that beats the re-render.
   */
  const [minting, setMinting] = useState(false);
  const mintInFlight = useRef(false);
  const owner = run.role === "owner";

  /**
   * Who is at the table, with yourself in it.
   *
   * The server's member list is the people it knows about, which for a
   * run nobody has been invited to is nobody at all -- so the panel
   * showed an empty box to the one person certainly sitting there. A
   * solo run has a player; it just has not had to tell anybody.
   */
  const listed: SessionMember[] = run.members ?? [];
  const mine = profile?.handle?.trim() || profile?.name?.trim() || "You";
  const members: SessionMember[] =
    me && !listed.some((m) => m.sub === me)
      ? [{ sub: me, name: mine, role: owner ? "owner" : (run.role ?? "player") } as SessionMember, ...listed]
      : listed;

  /**
   * The address a tool dials for one person, or for the table.
   *
   * Here rather than only behind Settings because this is the list of
   * who is playing, and setting a tool up is a thing you do per person
   * while looking at exactly that.
   *
   * A device that did not mint the key does not have it, and the server
   * keeps only a hash, so there is no address to finish and no way to
   * fetch one. Making a new key is the only way through; it costs the
   * old one, so it is asked for and not done quietly.
   */
  const copyAddress = async (seat: string | undefined, id: string) => {
    if (mintInFlight.current) return;
    let key = reach.key;
    if (!key) {
      if (!(await ask(newKeyQuestion(false)))) return;
      if (mintInFlight.current) return;
      mintInFlight.current = true;
      setMinting(true);
      try {
        key = await reach.mint();
      } finally {
        mintInFlight.current = false;
        setMinting(false);
      }
      if (!key) {
        // The server would not: gated, or nothing to reach. Nothing was
        // replaced and nothing is copied, and that is worth saying, since
        // the press otherwise looks like it did nothing at all.
        toast.show("Could not make a watch key.");
        return;
      }
    }
    const address = controlAddress({ key, runId: run.runId, seat });
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(id);
      window.setTimeout(() => setCopiedAddress((was) => (was === id ? null : was)), 1500);
    } catch {
      // A clipboard that refuses is the browser's call; the address is
      // still on screen to read.
    }
  };

  const [invites, setInvites] = useState<Invite[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(false);
  const inviteButton = useRef<HTMLButtonElement>(null);
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
    const read = () =>
      void api.reactions(run.runId).then(
        (r) => live && setReactions(r),
        () => {},
      );
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

  /** Send one invitation. Rejecting keeps the sheet open with what went wrong. */
  const invite = async (to: string, role: "player" | "viewer") => {
    try {
      await api.createInvite(run.runId, to, role);
    } catch (error) {
      // What the plan allows is the panel's business: the notice under the
      // buttons carries the link to what each plan has.
      if (error instanceof PlanError) {
        setUpgrade(error.message);
        return;
      }
      throw error;
    }
    toast.show(`Sent to ${to}. The link works for seven days.`);
    refresh();
  };

  /** Close the sheet and put the cursor back on the button that opened it. */
  const closeInvite = () => {
    setInviting(false);
    inviteButton.current?.focus();
  };

  /** Put the live link on the clipboard, and say so for a moment. */
  const copyLive = (link: string) => {
    void navigator.clipboard?.writeText(link).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  };

  /** Open the run to watchers and copy the link, so one press does both. */
  const share = () => {
    setBusy(true);
    setLiveNote(null);
    void api
      .shareRun(run.runId)
      .then(({ link }) => {
        // Already open keeps the link it has; the server cannot repeat one,
        // so what this device remembers is the link.
        if (link) rememberLiveLink(run.runId, link);
        const made = link ?? liveLinkOf(run.runId);
        setLiveLink(made);
        if (made) copyLive(made);
      })
      .catch((error: unknown) => {
        if (error instanceof PlanError) setUpgrade(error.message);
        else setLiveNote(error instanceof Error && error.message ? error.message : "That could not be done just now.");
      })
      .finally(() => setBusy(false));
  };

  /** Kill the link. */
  const stopSharing = () => {
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
  };

  /** What the live link is, said on the button rather than under it. */
  const liveTitle = "Anyone with this link watches the run as it happens, with no account.";

  /**
   * Whether this run has rules for a tool at all.
   *
   * The run's own control profile is what the server reads to decide
   * what an attached tool is told, so an empty one means nothing custom
   * can reach a game and the plug is not worth a column. A profile the
   * app ships for the pack counts for nothing until somebody picks it
   * into the run.
   */
  const supportsTool = !isEmpty(run.control as ControlProfile | undefined);

  /**
   * The tool on the table, which is one that named no seat.
   *
   * It belongs to the table and to nobody's row, the owner's included: a
   * tool dialed on the table's address is playing the run rather than a
   * seat in it, and lighting the owner as well would read as two tools
   * where there is one.
   */
  const tableTool = tools.find((t) => !t.seat);

  /** The tool on this person's game, by the seat its address named. */
  const toolOf = (m: SessionMember): AttachedTool | undefined => {
    const seat = (m.name ?? "").trim().toLowerCase();
    return seat ? tools.find((t) => (t.seat ?? "").trim().toLowerCase() === seat) : undefined;
  };

  /**
   * Decks on accounts the member list does not show.
   *
   * A deck signs in on its own account, which need not be one the run
   * knows about: a run nobody has been invited to lists one person, and
   * the count used to be the only sign a second deck was on at all. So
   * what no row can carry is said in a line under the rows rather than
   * dropped.
   */
  const strayDecks = deckSubs.filter((s) => !members.some((m) => m.sub === accountOf(s))).length;

  /**
   * Whether an address copied from here would be let in.
   *
   * The socket resolves a watch key to a run of the account's that is
   * open to watchers, so a closed run refuses the connection whatever
   * key it carries. That is the one thing the button cannot fix by
   * pressing it, so it is the one thing it refuses over. The run opens
   * itself on load, and `reach.link` is the first to know.
   */
  const reachable = shared || Boolean(reach.link);
  const copyLabel = reach.key ? "Copy connection address" : "Copy connection address (this device will need a new watch key)";
  const copyTitle = reachable ? copyLabel : "Share the run first";
  const copyButton = (seat: string | undefined, id: string) => (
    <button
      className="ghost tiny iconButton"
      title={copyTitle}
      aria-label={copyTitle}
      disabled={!reachable || minting}
      onClick={() => void copyAddress(seat, id)}
    >
      {copiedAddress === id ? <CheckGlyph /> : <CopyGlyph />}
    </button>
  );

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

  return (
    <details className="panel people members" open>
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
          /*
           * What is being waited for is this run, not the account.
           *
           * "Reaching your account" read as though signing in had not
           * taken, which it had: a run is a local thing until sync creates
           * it on the server, and until then there is nobody to invite to
           * it. Saying which of the two is still happening is the whole
           * difference between waiting and something being wrong.
           */
          <p className="muted small" aria-live="polite">
            This {noun} has not reached your account yet. Inviting opens when it has.
          </p>
        )}
        {members.length > 0 && (
          <div className="reactRow tableReact" aria-label="React">
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                className="reactButton"
                onClick={() => react(emoji)}
                title="Send this to everyone at the table and watching"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        {members.length > 0 && reactions.length > 0 && (
          <div className="reactRecent" aria-live="polite">
            {[...reactions]
              .reverse()
              .slice(0, 8)
              .map((r, i) => (
                <span key={`${r.at}-${i}`} className="chip reactChip" title={new Date(r.at).toLocaleTimeString()}>
                  {r.emoji}
                  {r.name ? ` ${r.name}` : ""}
                </span>
              ))}
          </div>
        )}
        {owner && (
          <div className="row spread memberRow">
            <span>
              <strong>The table</strong>
              <span className="muted small"> · everyone</span>
            </span>
            <span className="padRow">
              {/* No deck here: a deck belongs to a person, not to the table. */}
              {supportsTool && (
                <span className="toolIcons">
                  <ToolIcon lit={Boolean(tableTool)} label={tableTool ? `${tableTool.app ?? "Tool"} connected` : "No tool connected"}>
                    <PlugGlyph />
                  </ToolIcon>
                </span>
              )}
              {copyButton(undefined, "table")}
            </span>
          </div>
        )}
        {members.map((m) => {
          const deck = deckSubs.some((s) => accountOf(s) === m.sub);
          const tool = toolOf(m);
          return (
            <div
              key={m.sub}
              className={`row spread memberRow${m.sub === me ? " me" : ""}`}
              aria-current={m.sub === me ? "true" : undefined}
            >
              {/* The name is what gives when the row is narrow; the chip is not. */}
              <span className="memberWho">
                <span className="memberName">
                  <strong>{m.name ?? (m.sub === me ? "You" : "Somebody")}</strong>
                  <span className="muted small"> · {m.role}</span>
                </span>
                {m.sub === me && <span className="chip you">you</span>}
              </span>
              <span className="padRow">
                <span className="toolIcons">
                  <ToolIcon lit={deck} label={deck ? "Stream Deck connected" : "No Stream Deck connected"}>
                    <DeckGlyph />
                  </ToolIcon>
                  {supportsTool && (
                    <ToolIcon lit={Boolean(tool)} label={tool ? `${tool.app ?? "Tool"} connected` : "No tool connected"}>
                      <PlugGlyph />
                    </ToolIcon>
                  )}
                </span>
                {owner && m.name && copyButton(m.name, m.sub)}
                {owner && m.role !== "owner" && (
                  <button
                    className="ghost tiny iconButton"
                    title="Remove them from this run"
                    aria-label="Remove them from this run"
                    onClick={() => void api.removeMember(run.runId, m.sub).then(refresh, () => {})}
                  >
                    <XGlyph />
                  </button>
                )}
              </span>
            </div>
          );
        })}
        {strayDecks > 0 && (
          <p className="muted small">
            {strayDecks === 1
              ? "A Stream Deck not at the table is on this run."
              : `${strayDecks} Stream Decks not at the table are on this run.`}
          </p>
        )}

        {owner && pending.length > 0 && (
          <>
            <p className="muted small">Invited, not yet here</p>
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
        {(owner || Boolean(shared && liveLink)) && (
          <div className="row padRow memberActions">
            {owner && (
              <button ref={inviteButton} className="ghost small" onClick={() => setInviting(true)}>
                Invite someone
              </button>
            )}
            {shared && liveLink ? (
              <button className="ghost small" title={liveTitle} onClick={() => copyLive(liveLink)}>
                {copied ? "Copied" : "Copy live link"}
              </button>
            ) : (
              owner && (
                <button className="ghost small" title={liveTitle} disabled={busy} onClick={share}>
                  Share a live link
                </button>
              )
            )}
            {owner && shared && liveLink && (
              <button className="ghost small" disabled={busy} onClick={stopSharing}>
                Stop sharing
              </button>
            )}
          </div>
        )}
        {upgrade && (
          <p className="notice">
            {upgrade}. Subscribe from your profile, under Plan
            {hosted?.links.pricing ? (
              <>
                ; <a href={hosted.links.pricing}>what each plan has</a>
              </>
            ) : null}
            .
          </p>
        )}
        {liveNote && <p className="muted small">{liveNote}</p>}
        {inviting && (
          <InviteDialog people={people} redistributable={pack.license.redistributable} noun={noun} onSend={invite} onClose={closeInvite} />
        )}
        {dialog}
        {toast.node}
      </div>
    </details>
  );
}
