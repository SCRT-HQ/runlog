import { useEffect, useMemo, useState } from "react";
import { REACTIONS, type Reaction } from "../sync/client.ts";
import type { SeatKind } from "../run/seats.ts";
import { useApi } from "../sync/useApi.ts";
import { useAccount } from "../auth/Account.tsx";
import { LiveView } from "./LiveView.tsx";
import { SeatStrip } from "./SeatStrip.tsx";
import { useSeat } from "./useSeat.ts";
import { ThemeMenu } from "../theme/ThemeMenu.tsx";
import { linkTo } from "../route.ts";
import { runTitle, useTitle } from "../title.ts";
import { handoutLine } from "../run/handout.ts";
import { useToast } from "../ui/Toast.tsx";

/**
 * A run played from a seat: the watcher's page, with a strip.
 *
 * Everything on it comes off the snapshot the owner's device publishes, so
 * it draws results, the board, the log and the scoreboard and never the
 * pack. There is no Docs button, no export and no way into the Designer:
 * the pack is not here, and nothing on this page pretends it is. What the
 * pack is stays a title, a line and, where it is listed, its card.
 */
export function SeatRunView({ id, players }: { id: string; players: number }) {
  const { view, snapshot, held, note, stale, gesture, press } = useSeat(id);
  // Which shape the run is played in, as far as a seat can tell without the
  // pack: contestants on the board mean a moderator is holding the device,
  // and more than one player at the table means the table acts. The page
  // holding the run reads the pack and has the last word on any press; this
  // decides what to draw.
  const seating: SeatKind = snapshot && snapshot.contestants > 0 ? "moderated" : players > 1 ? "table" : "solo";
  const api = useApi();
  const account = useAccount();
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [sent, setSent] = useState(0);
  const toast = useToast();

  useEffect(() => {
    if (view?.reactions) setReactions(view.reactions);
  }, [view]);

  // The host handing a setup out. A seat is playing the run rather than
  // watching it, so being re-equipped without a word is worse here than
  // anywhere.
  useEffect(() => {
    const said = gesture ? handoutLine(gesture) : null;
    if (said) toast.show(said);
  }, [gesture, toast.show]);

  useTitle(snapshot ? runTitle(snapshot.runName, snapshot.packTitle) : (view?.run.packTitle ?? null));
  const recent = useMemo(() => [...reactions].reverse().slice(0, 8), [reactions]);

  const bar = (
    <header className="topbar liveBar">
      <a className="brand" href={linkTo("")}>
        <img className="logo" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
        <h1>Runlog</h1>
      </a>
      <span className="liveBarPack">
        <span className="shelfLabel muted small">your seat at</span> <strong>{view?.run.packTitle ?? "a run"}</strong>
      </span>
      <div className="topbarEnd">
        {view?.listing && (
          <a className="ghost" href={linkTo(`#marketplace/${encodeURIComponent(view.run.packId)}`)}>
            In the marketplace
          </a>
        )}
        <ThemeMenu />
      </div>
    </header>
  );

  // A seat is on an account, so there is nothing to draw for somebody who
  // is not on one. `checking` says nothing yet and falls through to the
  // line below, which is what waiting looks like everywhere else.
  if (account.status === "anonymous")
    return (
      <>
        {bar}
        <div className="live liveNote">
          <p>Sign in to take your seat.</p>
          <button className="primary" onClick={account.signIn}>
            Sign in
          </button>
        </div>
      </>
    );
  if (account.status === "local")
    return (
      <>
        {bar}
        <div className="live liveNote">
          <p>This copy is not connected to a Runlog account.</p>
        </div>
      </>
    );
  if (view === undefined)
    return (
      <>
        {bar}
        <div className="live liveNote muted">Loading…</div>
      </>
    );
  if (view === null)
    return (
      <>
        {bar}
        <div className="live liveNote">
          <p>This run is not one of yours. Ask whoever runs it for an invitation.</p>
        </div>
      </>
    );
  if (!snapshot)
    return (
      <>
        {bar}
        <div className="live liveNote">
          <h1 className="liveTitle">{view.run.packTitle ?? view.run.packId}</h1>
          <p className="muted">Nothing has been written to this run yet; it fills in with the next move.</p>
        </div>
      </>
    );

  const react = (emoji: string) => {
    if (!api || sent > Date.now()) return;
    setSent(Date.now() + 1000);
    void api.react(id, emoji).then(setReactions, () => {});
  };

  return (
    <>
      {bar}
      {toast.node}
      <LiveView
        snapshot={snapshot}
        stale={stale}
        side={
          <>
            <SeatStrip offer={snapshot.offer} seating={seating} held={held} note={note} onPress={press} />
            {(snapshot.status === "active" || recent.length > 0) && (
              <section className="panel react">
                <h3 className="sectionTitle">React</h3>
                {snapshot.status === "active" && (
                  <div className="reactRow" aria-label="React">
                    {REACTIONS.map((emoji) => (
                      <button key={emoji} className="reactButton" onClick={() => react(emoji)}>
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
                {recent.length > 0 && (
                  <div className="reactRecent" aria-live="polite">
                    {recent.map((r, i) => (
                      <span key={`${r.at}-${i}`} className="chip reactChip">
                        {r.emoji}
                        {r.name ? ` ${r.name}` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        }
      />
    </>
  );
}
