import { useEffect, useState } from "react";
import { useAccount } from "../auth/Account.tsx";
import type { Api, Connection, Connections } from "../sync/client.ts";
import { Button } from "../ui/Button.tsx";
import { clearPendingLink, pendingLink, type LinkRoute } from "./route.ts";

/**
 * The other accounts this one is linked to. Discord first: a link made
 * from Discord's side, where the bot knows who pressed `/link`, handed in
 * here as a code so the two accounts meet on this one's terms. The
 * section shows what is linked, offers to undo each of them, and, when a
 * code has just arrived by address, asks before binding it, since the
 * code says nothing about which Runlog account it should go to until this
 * moment.
 *
 * An account holds as many links as it makes: a second Discord account
 * joins the first rather than replacing it, which is what somebody with a
 * Discord account for their community and another for themselves needs.
 * The exclusivity runs the other way only, a Discord account belonging to
 * one Runlog account, because that is how the bot answers "who pressed
 * this button".
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
    api.connections().then(
      (c) => live && setKnown(c),
      () => live && setKnown({ available: false, connections: [], discord: null }),
    );
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
      setNote(error instanceof Error && error.message ? error.message : "Verification is unavailable here.");
      setBusy(false);
    }
  };
  const link = async () => {
    if (!api || !pending || pending.kind === "verify") return;
    setBusy(true);
    setNote(null);
    try {
      const discord = await api.linkDiscord(pending.code);
      const made: Connection = { service: "discord", accountId: discord.discordUserId, name: discord.name, linkedAt: discord.linkedAt };
      // What was known stays known: whether a verification can be offered,
      // in particular, so the button for it is there right away. The new
      // link joins whatever this account already holds.
      setKnown((k) => ({
        ...(k ?? { available: true, connections: [], discord: null }),
        available: true,
        discord: k?.discord ?? discord,
        connections: [...(k?.connections ?? []).filter((c) => c.accountId !== made.accountId), made],
      }));
      clearPendingLink();
      setPending(null);
      setNote(
        `Linked to Discord as ${discord.name}.${known?.verify ? " Select Verify for linked roles to use roles that require a linked account." : ""}`,
      );
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
  const unlink = async (accountId: string) => {
    if (!api) return;
    setBusy(true);
    setNote(null);
    try {
      await api.unlinkDiscord(accountId);
      setKnown((k) =>
        k
          ? {
              ...k,
              connections: k.connections.filter((c) => c.accountId !== accountId),
              discord: k.discord?.discordUserId === accountId ? null : k.discord,
            }
          : k,
      );
      setNote("Unlinked. Run /link in Discord to link it again, or another account.");
    } catch {
      setNote("Could not complete that action. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel connectionsPanel">
      <h3 className="sectionTitle">
        Linked accounts <span className="muted">Connect your Discord account</span>
      </h3>
      {pending?.kind === "verify" && pending.result === "asked" && (
        <div className="incoming">
          <div className="incomingWhat">
            <strong>A server asked Discord to verify your Runlog account.</strong>
            <div className="muted small">
              A role there is for members with a Runlog account linked. Verifying sends you to Discord to say which account is yours, links
              it here, and writes that on your Discord profile for the server to read.
              {account.status === "signed-in" ? ` You are signed in as ${account.user.email}.` : " Sign in first, and the request waits."}
            </div>
          </div>
          <div className="incomingActions">
            {account.status === "signed-in" ? (
              <Button variant="primary" disabled={!api} loading={busy} loadingLabel="Going to Discord…" onClick={() => void verify()}>
                Verify with Discord
              </Button>
            ) : account.status === "anonymous" ? (
              <>
                <Button variant="primary" onClick={account.signIn}>
                  Sign in to verify
                </Button>
                <Button onClick={account.signUp}>Create an account</Button>
              </>
            ) : null}
            <Button onClick={dismiss}>Not now</Button>
          </div>
        </div>
      )}
      {pending?.kind === "verify" && pending.result !== "asked" && (
        <p className="muted small connectionsStatus" role="status">
          <span className="connectionsStatusMessage">
            {pending.result === "done"
              ? "Verified. You can use server roles that require a linked Runlog account."
              : "Discord could not verify the account. Try again from the server role or here."}
          </span>
          <Button size="compact" onClick={dismiss}>
            OK
          </Button>
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
              <Button variant="primary" disabled={!api} loading={busy} loadingLabel="Linking…" onClick={() => void link()}>
                Link to this account
              </Button>
            ) : account.status === "anonymous" ? (
              <>
                <Button variant="primary" onClick={account.signIn}>
                  Sign in to link
                </Button>
                <Button onClick={account.signUp}>Create an account</Button>
              </>
            ) : null}
            <Button onClick={dismiss}>Not now</Button>
          </div>
        </div>
      )}
      {!api ? (
        <p className="muted small">Sign in to see linked accounts.</p>
      ) : known === null ? (
        <p className="muted small">Looking…</p>
      ) : !known.available && known.connections.length === 0 ? (
        <p className="muted small">Discord linking is unavailable here.</p>
      ) : (
        <DiscordLinks
          connections={known.connections}
          busy={busy}
          onUnlink={(id) => void unlink(id)}
          onVerify={known.verify ? () => void verify() : undefined}
        />
      )}
      {note && (
        <p className="muted small connectionsStatus" role="status">
          <span className="connectionsStatusMessage">{note}</span>
        </p>
      )}
    </section>
  );
}

/**
 * Every Discord account linked to this one, and the actions that can be
 * taken from Discord.
 *
 * A row for each names the account Discord showed when it was linked. The
 * help row retains a useful not-linked label for an empty list, but does not
 * invent another account when links already exist. Verification is offered
 * once rather than per account because it uses whichever Discord account is
 * currently signed in, which may be none of these.
 */
function DiscordLinks({
  connections,
  busy,
  onUnlink,
  onVerify,
}: {
  connections: Connection[];
  busy: boolean;
  onUnlink: (accountId: string) => void;
  onVerify?: () => void;
}) {
  return (
    <>
      {connections.map((c) => (
        <div key={c.accountId} className="row spread memberRow connectionsRow">
          <span className="connectionsIdentity">
            <strong>Discord</strong>
            <span className="muted small"> · linked as {c.name}</span>
          </span>
          <span className="row connectionsActions">
            <Button
              variant="danger"
              size="compact"
              disabled={busy}
              onClick={() => onUnlink(c.accountId)}
              title={`Unlink ${c.name} from this account`}
            >
              Unlink
            </Button>
          </span>
        </div>
      ))}
      <div className="row spread memberRow connectionsRow connectionsHelp">
        {connections.length === 0 && (
          <span className="connectionsIdentity">
            <strong>Discord</strong>
            <span className="muted small"> · not linked</span>
          </span>
        )}
        <span className="row connectionsActions">
          <span className="muted small connectionsInstructions">
            In a server with the Runlog bot, run /link and open the address it gives you.
          </span>
          {onVerify && (
            <Button
              size="compact"
              disabled={busy}
              onClick={onVerify}
              title={
                connections.length === 0
                  ? "Link through Discord to use server roles that require a linked account"
                  : "Link the current Discord account to use server roles that require a linked account"
              }
            >
              {connections.length === 0 ? "Link with Discord" : "Verify for linked roles"}
            </Button>
          )}
        </span>
      </div>
    </>
  );
}
