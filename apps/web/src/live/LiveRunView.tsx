import { useEffect, useMemo, useState } from "react";
import { DiceCurtain, rolledOf } from "../dice/DiceCurtain.tsx";
import { DocMenu } from "../docs/DocMenu.tsx";
import { useAccount } from "../auth/Account.tsx";
import { useApi } from "../sync/useApi.ts";
import { apiBase } from "../sync/config.ts";
import { reactToRun, REACTIONS, type Reaction } from "../sync/client.ts";
import { shownAs } from "../profile/shownAs.ts";
import { LiveView } from "./LiveView.tsx";
import { usePublicRun } from "./usePublic.ts";
import type { LiveRoute } from "./route.ts";

/**
 * A run watched by its link, by anyone.
 *
 * The page shows what the link's token gets: the whole run, reduced
 * here, when the pack's text may travel — and then the pack's own paper
 * is a press away — or the snapshot the owner's device keeps when it may
 * not. No account is needed, and nothing is kept. Anyone may send one of
 * a few reactions back to the table; someone signed in, where the pack
 * may travel, can take a seat as a watcher on their own account, and the
 * run follows them from then on.
 */
/** The bar above a watched run: the mark home, the pack's name, and the pack's card in the catalog when it has one. */
function LiveBar({ title, packId, listed }: { title: string | null; packId: string | null; listed: boolean }) {
  return (
    <header className="topbar liveBar">
      <a className="brand" href="./" title="Runlog: your packs">
        <img className="logo" src="./icon.svg" alt="" />
        <h1>Runlog</h1>
      </a>
      <span className="liveBarPack">
        <span className="shelfLabel muted small">watching</span> <strong>{title ?? "a run"}</strong>
      </span>
      <div className="topbarEnd">
        {listed && packId && (
          <a className="ghost" href={`./#catalog/${encodeURIComponent(packId)}`} title="The pack's card in the catalog: what it is, and how to get it">
            In the catalog
          </a>
        )}
        <a className="ghost" href="./#guide/streaming" title="How live links and widgets work">
          Docs
        </a>
      </div>
    </header>
  );
}

export function LiveRunView({ route, onWatch }: { route: LiveRoute; onWatch?: (runId: string) => Promise<void> }) {
  const { got, pack, snapshot, stale, offline, gesture } = usePublicRun(route.id, route.token);
  const roll = useMemo(() => (gesture ? rolledOf(gesture) : null), [gesture]);
  const account = useAccount();
  const api = useApi();
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [sent, setSent] = useState<number>(0);
  const [seat, setSeat] = useState<"idle" | "taking" | "taken">("idle");
  const [note, setNote] = useState<string | null>(null);
  const [shown, setShown] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (got?.reactions) setReactions(got.reactions);
  }, [got]);

  // Signed in, a reaction carries the name this person chose to be shown as.
  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.me().then((me) => live && setShown(shownAs(me.profile)), () => {});
    return () => {
      live = false;
    };
  }, [api]);

  const bar = <LiveBar title={got?.run.packTitle ?? snapshot?.packTitle ?? null} packId={got?.run.packId ?? null} listed={Boolean(got?.listing)} />;
  if (offline) {
    return (
      <>
        {bar}
        <div className="live liveNote">
          <p>A live link opens on the hosted copy of Runlog; this copy has no address to ask.</p>
        </div>
      </>
    );
  }
  if (got === undefined) {
    return (
      <>
        {bar}
        <div className="live liveNote muted">Fetching the run…</div>
      </>
    );
  }
  if (got === null) {
    return (
      <>
        {bar}
        <div className="live liveNote">
          <p>This link is not open any more, or never was. Ask whoever sent it for a fresh one.</p>
        </div>
      </>
    );
  }
  if (!snapshot) {
    return (
      <>
        {bar}
        <div className="live liveNote">
          <h1 className="liveTitle">{got.run.packTitle ?? got.run.packId}</h1>
          <p className="muted">{got.access === "snapshot" ? "The run is shared, but nothing has been written to it since; it fills in with the next move." : "The run's pack did not load."}</p>
        </div>
      </>
    );
  }

  const base = apiBase();
  const name = shown ?? "";
  const react = (emoji: string) => {
    if (!base || sent > Date.now()) return;
    // One a second: a reaction is a wave, not a keyboard.
    setSent(Date.now() + 1000);
    void reactToRun(base, route.id, route.token, emoji, name || undefined).then(setReactions, () => {});
  };
  const canSit = account.status === "signed-in" && api && onWatch && got.access === "full" && seat !== "taken";
  const recent = [...reactions].reverse().slice(0, 8);

  return (
    <>
      {bar}
      <DiceCurtain roll={roll} />
    <LiveView snapshot={snapshot} stale={stale}>
      <div className="liveTools">
        <div className="padRow">
          {pack ? (
            <DocMenu compact pack={pack} />
          ) : (
            <span className="muted small">{got.listing ? "The pack is in the catalog; the run shows its state, not its text." : "The pack's text is not for redistribution; the run shows its state, not its text."}</span>
          )}
          {canSit && (
            <button
              className="ghost tiny"
              disabled={seat === "taking"}
              title="The run joins your account as a watcher and follows you to every device you sign in on."
              onClick={() => {
                if (!api) return;
                setSeat("taking");
                setNote(null);
                void api
                  .watchPublicRun(route.id, route.token)
                  .then(async () => {
                    setSeat("taken");
                    await onWatch(route.id);
                  })
                  .catch((error: unknown) => {
                    setSeat("idle");
                    setNote(error instanceof Error && error.message ? error.message : "That seat could not be taken just now.");
                  });
              }}
            >
              {seat === "taking" ? "Taking a seat…" : "Watch from your account"}
            </button>
          )}
        </div>
        {snapshot.status === "active" && (
          <div className="reactRow" aria-label="React">
            {REACTIONS.map((emoji) => (
              <button key={emoji} className="reactButton" onClick={() => react(emoji)} title="Send this to the table">
                {emoji}
              </button>
            ))}
          </div>
        )}
        {recent.length > 0 && (
          <div className="reactRecent" aria-live="polite">
            {recent.map((r, i) => (
              <span key={`${r.at}-${i}`} className="chip reactChip" title={new Date(r.at).toLocaleTimeString()}>
                {r.emoji}
                {r.name ? ` ${r.name}` : ""}
              </span>
            ))}
          </div>
        )}
        {note && <p className="muted small">{note}</p>}
      </div>
    </LiveView>
    </>
  );
}
