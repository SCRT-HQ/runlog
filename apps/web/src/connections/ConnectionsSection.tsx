import { useEffect, useState } from "react";
import { useAccount } from "../auth/Account.tsx";
import type { Api, Connections, DiscordConnection } from "../sync/client.ts";
import { clearPendingLink, pendingLink, type LinkRoute } from "./route.ts";

/**
 * The other accounts this one is linked to. Discord first: a link made
 * from Discord's side, where the bot knows who pressed `/link`, handed in
 * here as a code so the two accounts meet on this one's terms. The
 * section shows what is linked, offers to undo it, and, when a code has
 * just arrived by address, asks before binding it, since the code says
 * nothing about which Runlog account it should go to until this moment.
 */
export function ConnectionsSection({ api, pending: pendingProp }: { api: Api | null; pending?: LinkRoute | null }) {
  const account = useAccount();
  const [pending, setPending] = useState<LinkRoute | null>(() => pendingProp ?? pendingLink("discord") ?? pendingLink("verify"));
  const [known, setKnown] = useState<Connections | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let live = true;
    api.connections().then((c) => live && setKnown(c), () => live && setKnown({ available: false, discord: null }));
    return () => {
      live = false;
    };
  }, [api]);

  const verify = async () => {
    if (!api) return;
    setBusy(true);
    setNote(null);
    try {
      const url = await api.discordVerifyUrl();
      clearPendingLink();
      location.assign(url);
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "Verifying is not available on this copy.");
      setBusy(false);
    }
  };
  const link = async () => {
    if (!api || !pending || pending.kind === "verify") return;
    setBusy(true);
    setNote(null);
    try {
      const discord = await api.linkDiscord(pending.code);
      // What was known stays known: whether a verification can be offered, in particular, so the button for it is there right away.
      setKnown((k) => ({ ...(k ?? { available: true }), available: true, discord }));
      clearPendingLink();
      setPending(null);
      setNote(`Linked. In Discord you are ${discord.name}; the bot knows you now.${known?.verify ? " For a server whose role asks for a linked account, press Verify for linked roles." : ""}`);
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "That code could not be linked.");
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => {
    clearPendingLink();
    setPending(null);
  };
  const unlink = async () => {
    if (!api) return;
    setBusy(true);
    setNote(null);
    try {
      await api.unlinkDiscord();
      setKnown((k) => (k ? { ...k, discord: null } : k));
      setNote("Unlinked. Run /link in Discord to link again, this account or another.");
    } catch {
      setNote("That did not go through; try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Linked accounts <span className="muted">Discord, and where the bot knows you</span>
      </h3>
      {pending?.kind === "verify" && pending.result === "asked" && (
        <div className="incoming">
          <div className="incomingWhat">
            <strong>A server asked Discord to verify your Runlog account.</strong>
            <div className="muted small">
              A role there is for members with a Runlog account linked. Verifying sends you to Discord to say which account is yours, links it here, and writes that on your Discord profile for the server to read.
              {account.status === "signed-in" ? ` You are signed in as ${account.user.email}.` : " Sign in first, and the request waits."}
            </div>
          </div>
          <div className="incomingActions">
            {account.status === "signed-in" ? (
              <button className="primary" disabled={busy || !api} aria-busy={busy || undefined} onClick={() => void verify()}>
                {busy ? "Going to Discord…" : "Verify with Discord"}
              </button>
            ) : account.status === "anonymous" ? (
              <>
                <button className="primary" onClick={account.signIn}>
                  Sign in to verify
                </button>
                <button className="ghost" onClick={account.signUp}>
                  Create an account
                </button>
              </>
            ) : null}
            <button className="ghost" onClick={dismiss}>
              Not now
            </button>
          </div>
        </div>
      )}
      {pending?.kind === "verify" && pending.result !== "asked" && (
        <p className="muted small" role="status">
          {pending.result === "done" ? "Verified. Discord knows this account is linked; a role that asks for it is yours to take in the server." : "Discord did not finish the verification. Try again from the server's role, or from the button here."}{" "}
          <button className="ghost tiny" onClick={dismiss}>
            OK
          </button>
        </p>
      )}
      {pending && pending.kind !== "verify" && (
        <div className="incoming">
          <div className="incomingWhat">
            <strong>Discord asked to link an account to this one.</strong>
            <div className="muted small">
              The code came from <code>/link</code>, pressed by a Discord account; linking makes that account this one for the bot.
              {account.status === "signed-in" ? ` You are signed in as ${account.user.email}.` : " Sign in first, and the code waits."}
            </div>
          </div>
          <div className="incomingActions">
            {account.status === "signed-in" ? (
              <button className="primary" disabled={busy || !api} aria-busy={busy || undefined} onClick={() => void link()}>
                {busy ? "Linking…" : "Link to this account"}
              </button>
            ) : account.status === "anonymous" ? (
              <>
                <button className="primary" onClick={account.signIn}>
                  Sign in to link
                </button>
                <button className="ghost" onClick={account.signUp}>
                  Create an account
                </button>
              </>
            ) : null}
            <button className="ghost" onClick={dismiss}>
              Not now
            </button>
          </div>
        </div>
      )}
      {!api ? (
        <p className="muted small">Sign in, and the accounts linked to this one are listed here.</p>
      ) : known === null ? (
        <p className="muted small">Looking…</p>
      ) : !known.available && !known.discord ? (
        <p className="muted small">This copy of Runlog has no Discord bot to link with.</p>
      ) : (
        <DiscordRow discord={known.discord} busy={busy} onUnlink={() => void unlink()} onVerify={known.verify ? () => void verify() : undefined} />
      )}
      {note && (
        <p className="muted small" role="status">
          {note}
        </p>
      )}
    </section>
  );
}

function DiscordRow({ discord, busy, onUnlink, onVerify }: { discord: DiscordConnection | null; busy: boolean; onUnlink: () => void; onVerify?: () => void }) {
  if (!discord) {
    return (
      <div className="row spread memberRow">
        <span>
          <strong>Discord</strong>
          <span className="muted small"> · not linked</span>
        </span>
        <span className="row">
          <span className="muted small">In a server with the Runlog bot, run /link and open the address it gives you.</span>
          {onVerify && (
            <button className="ghost tiny" disabled={busy} onClick={onVerify} title="Link through Discord instead, and let servers' linked roles see it">
              Link with Discord
            </button>
          )}
        </span>
      </div>
    );
  }
  return (
    <div className="row spread memberRow">
      <span>
        <strong>Discord</strong>
        <span className="muted small"> · linked as {discord.name}</span>
      </span>
      <span className="row">
        {onVerify && (
          <button className="ghost tiny" disabled={busy} onClick={onVerify} title="Write the link on your Discord profile, for servers whose roles ask for it">
            Verify for linked roles
          </button>
        )}
        <button className="ghost tiny" disabled={busy} onClick={onUnlink}>
          Unlink
        </button>
      </span>
    </div>
  );
}
