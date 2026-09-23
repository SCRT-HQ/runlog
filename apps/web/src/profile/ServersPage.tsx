import { useEffect, useMemo, useRef, useState } from "react";
import { loadPackText } from "@runlog/rules-schema";
import { useAccount } from "../auth/Account.tsx";
import { useHosted } from "../hosted/HostedProvider.tsx";
import { clearPendingLink, pendingLink, type LinkRoute } from "../connections/route.ts";
import type { Api, Guild, GuildPackMeta } from "../sync/client.ts";
import { hashText } from "../sync/hash.ts";
import { usePlan } from "../sync/usePlan.ts";
import { listPacks, type StoredPack } from "../storage/db.ts";
import type { ServerAvailability } from "./route.ts";

/** The account's own claimed-server list, read once the deployment is confirmed to offer servers at all. */
type GuildsState = { kind: "loading" } | { kind: "ready"; guilds: Guild[]; allowed: number } | { kind: "error"; message: string };

/** What a server may do about the owner's runs, in the order the picker shows them. */
export const WATCH_PARTY_CHOICES = [
  { value: "off" as const, label: "Off" },
  { value: "every" as const, label: "Every run" },
  { value: "packs" as const, label: "Chosen packs" },
];

const normalizeShelf = (packs: StoredPack[]): StoredPack[] =>
  packs.filter((pack) => !pack.deletedAt).sort((a, b) => a.title.localeCompare(b.title));

/**
 * The Discord servers this account claimed, and what the bot may play in
 * each. A server is claimed from Discord's side (`/setup claim` there
 * shows an address that lands here with a code), and this page asks
 * before binding it, since the code says nothing about which account
 * until now. The account that claims a server pays for the server plan
 * and fills the server's vault from its own shelf: the pack's text goes
 * up once, with the modes named so the bot can list them, and never comes
 * back down: the bot reads it to play, and members see the drawn lines.
 */
export function ServersPage({
  api,
  availability,
  onRetryPlan,
  pending: pendingProp,
  shelf: ownedShelf,
}: {
  api: Api | null;
  /** Whether this deployment offers servers at all, and whether that itself is still being confirmed. */
  availability: ServerAvailability;
  /** Asks the plan to be checked again, where confirming availability itself failed. */
  onRetryPlan: () => void;
  pending?: LinkRoute | null;
  /** The account-keyed profile owns this shelf when the page is rendered there. */
  shelf?: StoredPack[];
}) {
  const account = useAccount();
  const hosted = useHosted();
  const plan = usePlan();
  const [pending, setPending] = useState<LinkRoute | null>(() => pendingProp ?? pendingLink("guild"));
  const [guildsState, setGuildsState] = useState<GuildsState>({ kind: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [vaults, setVaults] = useState<Record<string, GuildPackMeta[]>>({});
  const [localShelf, setLocalShelf] = useState<StoredPack[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // A claim's own await can outlast a list state change (a concurrent
  // Retry, or the list simply arriving late): updateGuilds decides from
  // this always-current value, not the render closure it was created in,
  // so a state change mid-await is never silently missed.
  const guildsStateRef = useRef<GuildsState>(guildsState);
  guildsStateRef.current = guildsState;

  const updateGuilds = (fn: (guilds: Guild[]) => Guild[]) => {
    if (guildsStateRef.current.kind !== "ready") {
      // No real list to edit locally (still loading, or the last read
      // failed): ask the server again rather than inventing one from a
      // single action's result, with a made-up allowed count.
      setReloadToken((t) => t + 1);
      return;
    }
    setGuildsState((s) => (s.kind === "ready" ? { ...s, guilds: fn(s.guilds) } : s));
  };

  // Servers are not asked about until the deployment itself is confirmed to
  // offer them: asking earlier would either fail against a copy with no
  // server support, or race a plan answer that is still on its way.
  useEffect(() => {
    if (!api || availability !== "available") return;
    let live = true;
    setGuildsState({ kind: "loading" });
    void api.myGuilds().then(
      async (k) => {
        if (!live) return;
        setGuildsState({ kind: "ready", guilds: k.guilds, allowed: k.allowed });
        const all: Record<string, GuildPackMeta[]> = {};
        for (const g of k.guilds) all[g.guildId] = await api.guildPacks(g.guildId).catch(() => []);
        if (live) setVaults(all);
      },
      (error: unknown) => {
        if (!live) return;
        setGuildsState({
          kind: "error",
          message:
            error instanceof Error && error.message
              ? `Your servers could not be read: ${error.message}`
              : "Your servers could not be read just now.",
        });
      },
    );
    return () => {
      live = false;
    };
  }, [api, availability, reloadToken]);
  useEffect(() => {
    if (ownedShelf !== undefined) return;
    void listPacks().then(setLocalShelf);
  }, [ownedShelf]);
  const shelf = useMemo(() => normalizeShelf(ownedShelf ?? localShelf), [ownedShelf, localShelf]);

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
      if (!api || !pending || pending.kind !== "guild") return null;
      const { guild, upgrade } = await api.claimGuild(pending.code);
      updateGuilds((guilds) => [...guilds.filter((g) => g.guildId !== guild.guildId), guild]);
      clearPendingLink();
      setPending(null);
      return upgrade
        ? `${guild.name ?? "The server"} is yours. To host runs there, subscribe to Runlog for servers below; claiming and choosing packs work meanwhile.`
        : `${guild.name ?? "The server"} is yours. Add packs below, and set who may host with /setup role in Discord.`;
    });
  const dismiss = () => {
    clearPendingLink();
    setPending(null);
  };
  const release = (g: Guild) =>
    run(`release:${g.guildId}`, async () => {
      if (!api) return null;
      await api.releaseGuild(g.guildId);
      updateGuilds((guilds) => guilds.filter((x) => x.guildId !== g.guildId));
      return `${g.name ?? "The server"} is released; its vault is empty. Claim it again from Discord any time.`;
    });
  /** One id in or out of a list, kept in the order the shelf gives. */
  const pick = (had: string[], id: string, on: boolean) => (on ? [...had.filter((x) => x !== id), id] : had.filter((x) => x !== id));
  const setWatch = (g: Guild, mode: "off" | "every" | "packs", packIds?: string[]) =>
    run(`watch:${g.guildId}`, async () => {
      if (!api) return null;
      const saved = await api.setWatchParties(g.guildId, mode, packIds ?? g.watchPackIds);
      updateGuilds((guilds) => guilds.map((x) => (x.guildId === saved.guildId ? saved : x)));
      return null;
    });
  const add = (g: Guild) =>
    run(`add:${g.guildId}`, async () => {
      if (!api) return null;
      const pack = shelf.find((p) => p.id === picked[g.guildId]);
      if (!pack) return "Pick a pack from your shelf first.";
      const parsed = loadPackText(pack.source, pack.format);
      if (!parsed.ok) return "That pack does not load as it is; open it in the Designer first.";
      const modes = Object.entries(parsed.pack.modes).map(([id, m]) => ({ id, label: m.label ?? id }));
      const kept = await api.delegatePack(g.guildId, {
        packId: pack.id,
        title: pack.title,
        version: pack.version,
        format: pack.format,
        hash: await hashText(pack.source),
        modes,
        source: pack.source,
      });
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

  const planAccess = plan.access("hostServers");
  const readyPlan = plan.state.kind === "ready" ? plan.state : null;
  const billing = Boolean(hosted?.features.billing) || readyPlan?.gates === true;
  const planUnknown = planAccess === "checking" || planAccess === "error" || planAccess === "sign-in";
  const subscribed = readyPlan?.capabilities.hostServers === true;
  const openPreview = readyPlan !== null && !readyPlan.gates && !subscribed;
  // Only ever a real number, once the list itself has confirmed it; while
  // loading or failed, the sentence that would state it is left out rather
  // than guessing.
  const allowedGuilds = guildsState.kind === "ready" ? guildsState.allowed : null;

  /**
   * Why the bot can host runs in a given server: the account's own
   * subscription, its gates-off preview, or a plan the server itself
   * bought through Discord, never blurring one into the other.
   */
  const hostingStatus = (g: Guild): string => {
    if (subscribed) return "Hosting is active through your Runlog for servers subscription.";
    if (openPreview) return "Hosting is active: servers are open in preview here.";
    if (g.discord) return "Hosting is active through Discord.";
    return "Hosting needs Runlog for servers, or a subscription bought through Discord.";
  };

  return (
    <div className="profile profileApplication serverProfile">
      <h2>Servers</h2>
      {availability === "available" && (
        <p className="muted small">
          Discord servers you claimed. The bot hosts runs in them on the packs you put in each server's vault; members see what the dice
          draw, never the pack.
        </p>
      )}

      {pending && (
        <div className="incoming">
          <div className="incomingWhat">
            <strong>Discord asked to claim a server for this account.</strong>
            <div className="muted small">
              The code came from <code>/setup claim</code>, pressed by someone who can manage that server. The account that claims it pays
              for its plan and chooses its packs.
              {account.status === "signed-in" ? ` You are signed in as ${account.user.email}.` : " Sign in first, and the code waits."}
            </div>
          </div>
          <div className="incomingActions">
            {availability === "available" && account.status === "signed-in" ? (
              <button
                className="primary"
                disabled={busy !== null || !api}
                aria-busy={busy === "claim" || undefined}
                onClick={() => void claim()}
              >
                {busy === "claim" ? "Claiming…" : "Claim it for this account"}
              </button>
            ) : null}
            <button className="ghost" onClick={dismiss}>
              Not now
            </button>
          </div>
        </div>
      )}

      {availability === "checking" ? (
        <section className="panel">
          <p className="muted small">Checking server availability…</p>
        </section>
      ) : availability === "unavailable" ? (
        <section className="panel">
          <p className="muted small">Servers are not available on this deployment.</p>
        </section>
      ) : availability === "error" ? (
        <section className="panel">
          <p className="muted small">
            Server availability could not be checked.{" "}
            <button className="linkButton" onClick={() => void onRetryPlan()}>
              Try again
            </button>
          </p>
        </section>
      ) : !api ? (
        <section className="panel">
          <p className="muted small">Servers need the hosted copy of Runlog, signed in.</p>
        </section>
      ) : (
        <>
          {(billing || planUnknown) && (
            <section className="panel">
              {planUnknown ? (
                <>
                  <h3 className="sectionTitle">Plan</h3>
                  <p className="muted small">
                    {planAccess === "checking" ? (
                      "Checking your plan…"
                    ) : planAccess === "sign-in" ? (
                      "Sign in to check server hosting."
                    ) : (
                      <>
                        The plan could not be checked.{" "}
                        <button className="linkButton" onClick={() => void plan.refresh()}>
                          Try again
                        </button>
                      </>
                    )}
                  </p>
                </>
              ) : (
                <>
                  <h3 className="sectionTitle">
                    Plan:{" "}
                    <span className="muted">
                      {subscribed
                        ? "Runlog for servers, active"
                        : openPreview
                          ? "available in preview"
                          : readyPlan?.offers.serversOpen
                            ? "none yet"
                            : "coming soon"}
                    </span>
                  </h3>
                  <p className="muted small">
                    {subscribed
                      ? "The bot hosts runs in your servers. A subscription is managed with Stripe, under Plan on your profile."
                      : openPreview
                        ? "Server hosting is available while plans are not switched on here."
                        : readyPlan?.offers.serversOpen
                          ? allowedGuilds !== null
                            ? `Runlog for servers lets the bot host runs in the servers you claim. One subscription covers up to ${allowedGuilds} servers.`
                            : "Runlog for servers lets the bot host runs in the servers you claim."
                          : allowedGuilds !== null
                            ? `Runlog for servers will let the bot host runs in the servers you claim, one subscription for up to ${allowedGuilds}. Claiming a server and filling its vault work now; the plan is not on sale yet.`
                            : "Runlog for servers will let the bot host runs in the servers you claim. Claiming a server and filling its vault work now; the plan is not on sale yet."}
                  </p>
                </>
              )}
              {planAccess === "upgrade" && (
                <div className="padRow">
                  {readyPlan?.offers.serversOpen ? (
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

          {guildsState.kind === "loading" ? (
            <section className="panel">
              <p className="muted small">Looking…</p>
            </section>
          ) : guildsState.kind === "error" ? (
            <section className="panel">
              <p className="muted small">
                {guildsState.message}{" "}
                <button className="linkButton" onClick={() => setReloadToken((t) => t + 1)}>
                  Retry
                </button>
              </p>
            </section>
          ) : guildsState.guilds.length === 0 ? (
            <section className="panel">
              <h3 className="sectionTitle">No servers yet</h3>
              <p className="muted small">
                In a Discord server of yours, add the Runlog bot, run /setup claim, and open the address it gives you: it lands here, and
                the server is yours to fill.
              </p>
            </section>
          ) : (
            guildsState.guilds.map((g) => {
              const inVault = vaults[g.guildId] ?? [];
              const candidates = shelf.filter((p) => !inVault.some((v) => v.id === p.id));
              return (
                <section key={g.guildId} className="panel">
                  <h3 className="sectionTitle">
                    {g.name ?? `Server ${g.guildId}`} <span className="muted">claimed {onDay(g.claimedAt)}</span>
                    {g.discord && <span className="plan plan-plus">Subscribed through Discord</span>}
                  </h3>
                  <p className="muted small">{hostingStatus(g)}</p>
                  {inVault.length === 0 ? (
                    <p className="muted small">Nothing in the vault yet. Add a pack from your shelf and /packs in Discord lists it.</p>
                  ) : (
                    inVault.map((p) => (
                      <div key={p.id} className="row spread memberRow serverVaultRow">
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
                    <label htmlFor={`watch-${g.guildId}`}>Watch parties</label>
                    <select
                      id={`watch-${g.guildId}`}
                      className="chipAdd"
                      value={g.watchParties ?? "off"}
                      disabled={busy !== null}
                      onChange={(e) => void setWatch(g, e.target.value as "off" | "every" | "packs")}
                    >
                      {WATCH_PARTY_CHOICES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {g.watchParties === "packs" && (
                    <div className="padRow">
                      {shelf.map((p) => (
                        <label key={p.id} className="muted small">
                          <input
                            type="checkbox"
                            checked={(g.watchPackIds ?? []).includes(p.id)}
                            disabled={busy !== null}
                            onChange={(e) => void setWatch(g, "packs", pick(g.watchPackIds ?? [], p.id, e.target.checked))}
                          />
                          {p.title}
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="padRow">
                    <select
                      className="chipAdd"
                      aria-label={`A pack to add to ${g.name ?? "this server"}`}
                      value={picked[g.guildId] ?? ""}
                      onChange={(e) => setPicked((p) => ({ ...p, [g.guildId]: e.target.value }))}
                    >
                      <option value="">Add a pack from your shelf…</option>
                      {candidates.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                    <button
                      className="ghost tiny"
                      disabled={busy !== null || !picked[g.guildId]}
                      aria-busy={busy === `add:${g.guildId}` || undefined}
                      onClick={() => void add(g)}
                    >
                      Add
                    </button>
                    <button
                      className="ghost tiny"
                      disabled={busy !== null}
                      onClick={() => void release(g)}
                      title="The server is no longer yours and its vault is emptied; claim it again from Discord any time"
                    >
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
