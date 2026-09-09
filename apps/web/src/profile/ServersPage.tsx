import { useEffect, useState } from "react";
import { loadPackText } from "@runlog/rules-schema";
import { useAccount } from "../auth/Account.tsx";
import { useHosted } from "../hosted/HostedProvider.tsx";
import { clearPendingLink, pendingLink, type LinkRoute } from "../connections/route.ts";
import type { Api, Guild, GuildPackMeta } from "../sync/client.ts";
import { hashText } from "../sync/hash.ts";
import { usePlan } from "../sync/usePlan.ts";
import { listPacks, type StoredPack } from "../storage/db.ts";

/**
 * The Discord servers this account claimed, and what the bot may play in
 * each. A server is claimed from Discord's side (`/setup claim` there
 * shows an address that lands here with a code), and this page asks
 * before binding it, since the code says nothing about which account
 * until now. The account that claims a server pays for the server plan
 * and fills the server's vault from its own shelf: the pack's text goes
 * up once, with the modes named so the bot can list them, and never comes
 * back down — the bot reads it to play, and members see the drawn lines.
 */
export function ServersPage({ api, pending: pendingProp }: { api: Api | null; pending?: LinkRoute | null }) {
  const account = useAccount();
  const hosted = useHosted();
  const plan = usePlan();
  const [pending, setPending] = useState<LinkRoute | null>(() => pendingProp ?? pendingLink("guild"));
  const [known, setKnown] = useState<{ guilds: Guild[]; server: boolean; open: boolean } | null>(null);
  const [vaults, setVaults] = useState<Record<string, GuildPackMeta[]>>({});
  const [shelf, setShelf] = useState<StoredPack[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.myGuilds().then(
      async (k) => {
        if (!live) return;
        setKnown(k);
        const all: Record<string, GuildPackMeta[]> = {};
        for (const g of k.guilds) all[g.guildId] = await api.guildPacks(g.guildId).catch(() => []);
        if (live) setVaults(all);
      },
      () => live && setKnown({ guilds: [], server: true, open: false }),
    );
    return () => {
      live = false;
    };
  }, [api]);
  useEffect(() => {
    void listPacks().then((all) => setShelf(all.filter((p) => !p.deletedAt).sort((a, b) => a.title.localeCompare(b.title))));
  }, []);

  const run = async (what: string, fn: () => Promise<string | null>) => {
    setBusy(what);
    setNote(null);
    try {
      setNote(await fn());
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "That did not go through; try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  const claim = () =>
    run("claim", async () => {
      if (!api || !pending) return null;
      const { guild, upgrade } = await api.claimGuild(pending.code);
      setKnown((k) => ({ guilds: [...(k?.guilds ?? []).filter((g) => g.guildId !== guild.guildId), guild], server: k?.server ?? !upgrade, open: k?.open ?? false }));
      clearPendingLink();
      setPending(null);
      return upgrade ? `${guild.name ?? "The server"} is yours. To host runs there, subscribe to Runlog for servers below; claiming and choosing packs work meanwhile.` : `${guild.name ?? "The server"} is yours. Add packs below, and set who may host with /setup role in Discord.`;
    });
  const dismiss = () => {
    clearPendingLink();
    setPending(null);
  };
  const release = (g: Guild) =>
    run(`release:${g.guildId}`, async () => {
      if (!api) return null;
      await api.releaseGuild(g.guildId);
      setKnown((k) => (k ? { ...k, guilds: k.guilds.filter((x) => x.guildId !== g.guildId) } : k));
      return `${g.name ?? "The server"} is released; its vault is empty. Claim it again from Discord any time.`;
    });
  const add = (g: Guild) =>
    run(`add:${g.guildId}`, async () => {
      if (!api) return null;
      const pack = shelf.find((p) => p.id === picked[g.guildId]);
      if (!pack) return "Pick a pack from your shelf first.";
      const parsed = loadPackText(pack.source, pack.format);
      if (!parsed.ok) return "That pack does not load as it is; open it in the Designer first.";
      const modes = Object.entries(parsed.pack.modes).map(([id, m]) => ({ id, label: m.label ?? id }));
      const kept = await api.delegatePack(g.guildId, { packId: pack.id, title: pack.title, version: pack.version, format: pack.format, hash: await hashText(pack.source), modes, source: pack.source });
      setVaults((v) => ({ ...v, [g.guildId]: [...(v[g.guildId] ?? []).filter((p) => p.id !== kept.id), kept] }));
      return `${kept.title} is in the vault. /packs in Discord lists it now.`;
    });
  const remove = (g: Guild, packId: string) =>
    run(`remove:${g.guildId}:${packId}`, async () => {
      if (!api) return null;
      await api.undelegatePack(g.guildId, packId);
      setVaults((v) => ({ ...v, [g.guildId]: (v[g.guildId] ?? []).filter((p) => p.id !== packId) }));
      return null;
    });
  const checkout = (price: "server-monthly" | "server-yearly") =>
    run("checkout", async () => {
      if (!api) return null;
      const out = await api.checkout(price);
      if ("url" in out) {
        location.href = out.url;
        return null;
      }
      return "Billing is not switched on here yet.";
    });

  const billing = Boolean(hosted?.features.billing) || plan.gates;

  return (
    <div className="profile">
      <h2>Servers</h2>
      <p className="muted small">Discord servers you claimed. The bot hosts runs in them on the packs you put in each server's vault; members see what the dice draw, never the pack.</p>

      {pending && (
        <div className="incoming">
          <div className="incomingWhat">
            <strong>Discord asked to claim a server for this account.</strong>
            <div className="muted small">
              The code came from <code>/setup claim</code>, pressed by someone who can manage that server. The account that claims it pays for its plan and chooses its packs.
              {account.status === "signed-in" ? ` You are signed in as ${account.user.email}.` : " Sign in first, and the code waits."}
            </div>
          </div>
          <div className="incomingActions">
            {account.status === "signed-in" ? (
              <button className="primary" disabled={busy !== null || !api} aria-busy={busy === "claim" || undefined} onClick={() => void claim()}>
                {busy === "claim" ? "Claiming…" : "Claim it for this account"}
              </button>
            ) : account.status === "anonymous" ? (
              <>
                <button className="primary" onClick={account.signIn}>
                  Sign in to claim
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
        <section className="panel">
          <p className="muted small">Servers need the hosted copy of Runlog, signed in.</p>
        </section>
      ) : known === null ? (
        <section className="panel">
          <p className="muted small">Looking…</p>
        </section>
      ) : (
        <>
          {billing && (
            <section className="panel">
              <h3 className="sectionTitle">
                Plan: <span className="muted">{known.server ? "Runlog for servers, active" : known.open ? "none yet" : "coming soon"}</span>
              </h3>
              <p className="muted small">
                {known.server
                  ? "The bot hosts runs in your servers. A subscription is managed with Stripe, under Plan on your profile."
                  : known.open
                    ? "Runlog for servers lets the bot host runs in the servers you claim. One subscription covers up to three servers."
                    : "Runlog for servers will let the bot host runs in the servers you claim, one subscription for up to three. Claiming a server and filling its vault work now; the plan is not on sale yet."}
              </p>
              {!known.server && (
                <div className="padRow">
                  {known.open ? (
                    <>
                      <button className="primary tiny" disabled={busy !== null} onClick={() => void checkout("server-monthly")}>
                        Servers, $9 a month
                      </button>
                      <button className="ghost" disabled={busy !== null} onClick={() => void checkout("server-yearly")}>
                        $90 a year
                      </button>
                    </>
                  ) : (
                    <button className="primary tiny" disabled title="Not on sale yet">
                      Coming soon
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          {known.guilds.length === 0 ? (
            <section className="panel">
              <h3 className="sectionTitle">No servers yet</h3>
              <p className="muted small">In a Discord server of yours, add the Runlog bot, run /setup claim, and open the address it gives you: it lands here, and the server is yours to fill.</p>
            </section>
          ) : (
            known.guilds.map((g) => {
              const inVault = vaults[g.guildId] ?? [];
              const candidates = shelf.filter((p) => !inVault.some((v) => v.id === p.id));
              return (
                <section key={g.guildId} className="panel">
                  <h3 className="sectionTitle">
                    {g.name ?? `Server ${g.guildId}`} <span className="muted">claimed {onDay(g.claimedAt)}</span>
                    {g.discord && <span className="plan plan-plus">Subscribed through Discord</span>}
                  </h3>
                  {inVault.length === 0 ? (
                    <p className="muted small">Nothing in the vault yet. Add a pack from your shelf and /packs in Discord lists it.</p>
                  ) : (
                    inVault.map((p) => (
                      <div key={p.id} className="row spread memberRow">
                        <span>
                          <strong>{p.title}</strong>
                          <span className="muted small"> · {p.modes.map((m) => m.label).join(", ") || "one mode"}</span>
                        </span>
                        <button className="ghost tiny" disabled={busy !== null} onClick={() => void remove(g, p.id)}>
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                  <div className="padRow">
                    <select className="chipAdd" aria-label={`A pack to add to ${g.name ?? "this server"}`} value={picked[g.guildId] ?? ""} onChange={(e) => setPicked((p) => ({ ...p, [g.guildId]: e.target.value }))}>
                      <option value="">Add a pack from your shelf…</option>
                      {candidates.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                    <button className="ghost tiny" disabled={busy !== null || !picked[g.guildId]} aria-busy={busy === `add:${g.guildId}` || undefined} onClick={() => void add(g)}>
                      Add
                    </button>
                    <button className="ghost tiny" disabled={busy !== null} onClick={() => void release(g)} title="The server is no longer yours and its vault is emptied; claim it again from Discord any time">
                      Release
                    </button>
                  </div>
                  <p className="muted small">Who may host, and where runs open, are set in Discord with /setup role and /setup channel.</p>
                </section>
              );
            })
          )}
        </>
      )}
      {note && (
        <p className="muted small" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

function onDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
