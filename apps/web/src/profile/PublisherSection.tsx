import { useEffect, useState } from "react";
import { featuresOf, generateDoc, loadPackText, priceDisplay } from "@runlog/rules-schema";
import YAML from "yaml";
import { useHosted } from "../hosted/HostedProvider.tsx";
import { usePlan } from "../sync/usePlan.ts";
import { listPacks, type StoredPack } from "../storage/db.ts";
import { priceDisplay as showPrice } from "@runlog/rules-schema";
import type { Api, PublisherInvitation, PublisherMember, PublisherPack, PublisherView, SaleRow } from "../sync/client.ts";

/**
 * Publishing, from the profile: become a publisher, set up payouts with
 * Stripe, open the Stripe dashboard. Stripe's onboarding is its own
 * pages; the app sends the person there and reads the state when they
 * come back with `?publisher=` on the address. Listing packs and the
 * sales ledger come with the catalog's next step.
 */
export function PublisherSection({ api }: { api: Api | null }) {
  const hosted = useHosted();
  const [publisher, setPublisher] = useState<PublisherView | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let live = true;
    let outcome: string | null = null;
    try {
      const url = new URL(location.href);
      outcome = url.searchParams.get("publisher");
      if (outcome) {
        url.searchParams.delete("publisher");
        history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
      }
    } catch {
      /* nothing to read */
    }
    const load = outcome ? api.refreshPublisherConnect() : api.myPublisher();
    void load.then(
      (p) => {
        if (!live) return;
        setPublisher(p);
        if (outcome === "connected") setNote(p?.connectReady ? "Payouts are set up. You can list packs for sale." : "Stripe is still checking a few things; press Refresh in a moment.");
        if (outcome === "connect-again") setNote("That link had expired. Set up payouts again to continue where you left off.");
      },
      () => live && setPublisher(null),
    );
    return () => {
      live = false;
    };
  }, [api]);

  if (!api || publisher === undefined) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "That could not be done just now.");
    } finally {
      setBusy(false);
    }
  };

  if (!publisher) {
    return (
      <section className="panel">
        <h3 className="sectionTitle">
          Publishing <span className="muted">list packs in the catalog</span>
        </h3>
        <p className="muted small">
          A publisher is a name in the catalog and, once payouts are set up, a seller: buyers pay you directly through Stripe, and the
          catalog takes a small share per sale{hosted?.links.pricing ? <> (<a href={hosted.links.pricing}>how much</a>)</> : null}.
          {hosted?.links.publishers ? (
            <>
              {" "}
              Becoming one accepts the <a href={hosted.links.publishers}>publisher agreement</a>.
            </>
          ) : null}
        </p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            void run(async () => {
              setPublisher(await api.becomePublisher(n));
              setName("");
            });
          }}
        >
          <input className="textInput" value={name} placeholder="your name in the catalog" maxLength={120} onChange={(e) => setName(e.target.value)} />
          <button className="primary tiny" type="submit" disabled={busy || !name.trim()}>
            Become a publisher
          </button>
        </form>
        {note && <p className="muted small">{note}</p>}
      </section>
    );
  }

  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Publishing <span className="muted">as {publisher.name}</span>
      </h3>
      <p className="muted small">
        {publisher.connectReady
          ? "Payouts are set up: buyers pay you directly through Stripe. Your sales, keys and payouts are in the Stripe dashboard."
          : publisher.connectStarted
            ? "Payouts are started but Stripe has not finished checking. Continue the setup, or refresh once it has."
            : "Before a pack can be sold, Stripe needs to know where to pay you. The setup is Stripe's own pages; it takes a few minutes."}
      </p>
      {publisher.owner && (
        <div className="padRow">
          {!publisher.connectReady && (
            <button
              className="primary tiny"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const out = await api.connectPublisher();
                  if ("url" in out) location.href = out.url;
                  else setNote("Payouts cannot be set up here yet: billing is not switched on.");
                })
              }
            >
              {publisher.connectStarted ? "Continue payout setup" : "Set up payouts"}
            </button>
          )}
          {publisher.connectStarted && (
            <button className="ghost" disabled={busy} onClick={() => void run(async () => setPublisher(await api.refreshPublisherConnect()))}>
              Refresh
            </button>
          )}
          {publisher.connectReady && (
            <button
              className="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const out = await api.publisherDashboard();
                  if ("url" in out) location.href = out.url;
                })
              }
            >
              Open the Stripe dashboard
            </button>
          )}
        </div>
      )}
      {!publisher.owner && <p className="muted small">The one who founded {publisher.name} sets up its payouts.</p>}
      {note && <p className="muted small">{note}</p>}
      {publisher.owner && <HostedLicensing api={api} />}
      <PublisherPacks api={api} publisher={publisher} />
      <Members api={api} publisher={publisher} />
      <Sales api={api} />
    </section>
  );
}

/**
 * The people in the publisher. An admin invites by email, WorkOS sends
 * the mail, and accepting it through the usual sign-in makes them a
 * member, and can take an invitation back or a member out. A member
 * sees who is in it. Every member can upload, list and see the ledger;
 * the founder alone sets up payouts.
 */
function Members({ api, publisher }: { api: Api; publisher: PublisherView }) {
  const [members, setMembers] = useState<PublisherMember[] | null>(null);
  const [invitations, setInvitations] = useState<PublisherInvitation[]>([]);
  const [available, setAvailable] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const admin = publisher.owner || publisher.role === "admin";
  const refresh = () =>
    void api.publisherMembers().then(
      (out) => {
        setMembers(out.members);
        setInvitations(out.invitations);
        setAvailable(out.available !== false);
      },
      () => setMembers([]),
    );
  useEffect(refresh, [api]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<unknown>, said?: string) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      if (said) setNote(said);
      refresh();
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "That could not be done just now.");
    } finally {
      setBusy(false);
    }
  };
  const invite = () =>
    act(async () => {
      const out = await api.invitePublisherMember(email.trim(), role);
      if ("available" in out) throw new Error("Invitations are not switched on here.");
      setEmail("");
    }, `Invited ${email.trim()}. They get a mail from WorkOS; accepting it puts them in ${publisher.name}.`);
  return (
    <div className="publisherPacks">
      <h4 className="stepLabel">People in {publisher.name}</h4>
      {members === null && <p className="muted small">Reading…</p>}
      {members?.map((m) => (
        <div key={m.userId} className="row spread memberRow publisherPack">
          <span>
            <strong>{m.name ?? m.email ?? m.userId}</strong>
            <span className="muted small">
              {" "}
              {m.email && m.name ? `${m.email} · ` : ""}
              {m.owner ? "founder" : m.role}
              {m.me ? " · you" : ""}
            </span>
          </span>
          <span className="row">
            {admin && !m.owner && !m.me && (
              <button className="ghost tiny" disabled={busy} title={`Take ${m.name ?? m.email ?? "them"} out of ${publisher.name}`} onClick={() => void act(() => api.removePublisherMember(m.userId), "Removed.")}>
                Remove
              </button>
            )}
          </span>
        </div>
      ))}
      {invitations.map((i) => (
        <div key={i.id} className="row spread memberRow publisherPack">
          <span>
            <strong>{i.email}</strong>
            <span className="muted small"> invited · until {i.expiresAt.slice(0, 10)}</span>
          </span>
          <span className="row">
            {admin && (
              <button className="ghost tiny" disabled={busy} onClick={() => void act(() => api.revokePublisherInvitation(i.id), "Invitation taken back.")}>
                Revoke
              </button>
            )}
          </span>
        </div>
      ))}
      {admin && available && (
        <div className="inviteForm">
          <input className="textInput" type="email" placeholder="their email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && email.includes("@") && void invite()} aria-label="Email address to invite" />
          <select className="chipAdd" value={role} onChange={(e) => setRole(e.target.value === "admin" ? "admin" : "member")} aria-label="Their role">
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <button className="ghost tiny" disabled={busy || !email.includes("@")} onClick={() => void invite()}>
            Invite
          </button>
        </div>
      )}
      {admin && !available && <p className="muted small">Invitations need the hosted address; here the publisher is just you.</p>}
      <p className="muted small">A member uploads and lists packs and sees the ledger; an admin also invites and removes people. Payouts stay with the founder.</p>
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}

/** The ledger: what sold, to whom, for how much; a lost key sent again; a key revoked. */
function Sales({ api }: { api: Api }) {
  const [sales, setSales] = useState<SaleRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const refresh = () => void api.sales().then(setSales, () => setSales([]));
  useEffect(refresh, [api]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sales || sales.length === 0) return null;
  const act = async (ref: string, fn: () => Promise<unknown>, said: string) => {
    setBusy(ref);
    setNote(null);
    try {
      await fn();
      setNote(said);
      refresh();
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "That could not be done just now.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="publisherPacks">
      <h4 className="stepLabel">Sales</h4>
      {sales.map((s) => (
        <div key={s.ref} className="row spread memberRow">
          <span>
            <strong>{s.title}</strong>
            <span className="muted small">
              {" "}
              · {showPrice({ amount: s.amount, currency: s.currency })} · {s.buyerEmail ?? "no address"} · {s.createdAt.slice(0, 10)} · {s.status}
            </span>
            <div className="mono small muted">{s.ref}</div>
          </span>
          <span className="row">
            {s.status === "fulfilled" && (
              <>
                <button className="ghost tiny" disabled={busy === s.ref || !s.buyerEmail} title="Send the key and a fresh link to the buyer again" onClick={() => void act(s.ref, () => api.reissueSale(s.ref), `Sent again to ${s.buyerEmail}.`)}>
                  Reissue
                </button>
                <button className="ghost tiny" disabled={busy === s.ref} title="Stop this copy being fetched again" onClick={() => void act(s.ref, () => api.revokeSale(s.ref), "Revoked.")}>
                  Revoke
                </button>
              </>
            )}
          </span>
        </div>
      ))}
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}

/**
 * Hosted licensing: the publisher's subscription, held by the founder.
 * With it the catalog takes no share of a sale; without it, five percent.
 * Stripe's Checkout and Portal, like Plus; shown where billing is on.
 */
function HostedLicensing({ api }: { api: Api }) {
  const hosted = useHosted();
  const plan = usePlan();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!(hosted?.features.billing || plan.gates)) return null;
  const subscribed = plan.entitlements.includes("hosted-licensing");
  const go = async (fn: () => Promise<{ url: string } | { available: false }>) => {
    setBusy(true);
    setNote(null);
    try {
      const out = await fn();
      if ("url" in out) location.href = out.url;
      else setNote("Billing is not switched on here yet.");
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "That could not be started.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="publisherPacks">
      <h4 className="stepLabel">Hosted licensing {subscribed ? <span className="muted">on</span> : null}</h4>
      <p className="muted small">
        {subscribed
          ? "The catalog takes no share of your sales. Manage the subscription with Stripe."
          : "The catalog takes 5% of each sale. With hosted licensing, $9 a month or $90 a year, it takes nothing; worth it once you sell more than a few a month."}
      </p>
      <div className="padRow">
        {subscribed ? (
          <button className="ghost tiny" disabled={busy} onClick={() => void go(() => api.portal())}>
            Manage subscription
          </button>
        ) : (
          <>
            <button className="ghost tiny" disabled={busy} onClick={() => void go(() => api.checkout("hosted-monthly"))}>
              $9 a month
            </button>
            <button className="ghost tiny" disabled={busy} onClick={() => void go(() => api.checkout("hosted-yearly"))}>
              $90 a year
            </button>
          </>
        )}
      </div>
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}

/**
 * What the publisher has uploaded, and what it is listed at. Uploading
 * takes a pack from this device's library, the head and the summary the
 * catalog shows are computed here, the way the catalog would, and the
 * listing is free, or a price in whole dollars once payouts are set up.
 */
export function PublisherPacks({ api, publisher }: { api: Api; publisher: PublisherView }) {
  const [packs, setPacks] = useState<PublisherPack[] | null>(null);
  const [library, setLibrary] = useState<StoredPack[]>([]);
  const [chosen, setChosen] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  /** Which rows have their price field open; hidden otherwise so a row reads as its price, not a form. */
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  /** The one row, if any, asking "are you sure" with the pack's own name. */
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = () => void api.publisherPacks().then(setPacks, () => setPacks([]));
  useEffect(() => {
    refresh();
    void listPacks().then((all) => setLibrary(all.filter((p) => !p.deletedAt && !p.sealed)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setNote(null);
    try {
      await fn();
      refresh();
    } catch (error) {
      setNote(error instanceof Error && error.message ? error.message : "That could not be done just now.");
    } finally {
      setBusy(null);
    }
  };

  const upload = async () => {
    const record = library.find((p) => p.id === chosen);
    if (!record) return;
    const loaded = loadPackText(record.source, record.format);
    if (!loaded.ok) throw new Error("that pack does not load; fix it in the Designer first");
    const pack = loaded.pack;
    const raw = (record.format === "json" ? JSON.parse(record.source) : YAML.parse(record.source)) as Record<string, unknown>;
    const { features, players } = featuresOf(raw);
    const head = {
      title: pack.title,
      version: pack.version,
      ...(pack.author ? { author: pack.author } : {}),
      ...(pack.description ? { description: pack.description } : {}),
      category: pack.category ?? "other",
      tags: pack.tags ?? [],
      features,
      requires: (pack.requires ?? []).map((r) => ({ label: r.label, kind: r.kind, optional: r.optional })),
      players,
      license: { id: pack.license.id, redistributable: pack.license.redistributable },
    };
    await api.putPublisherPack(pack.id, { source: record.source, head, summary: generateDoc(pack, "summary") });
    setChosen("");
  };

  const list = async (p: PublisherPack) => {
    const dollars = (prices[p.packId] ?? "").trim();
    const amount = dollars ? Math.round(Number(dollars) * 100) : 0;
    if (dollars && (!Number.isFinite(amount) || amount < 100 || amount > 100_000)) throw new Error("a price is between 1 and 1000, in dollars, or blank for free");
    const out = await api.listPublisherPack(p.packId, amount > 0 ? { amount, currency: "usd" } : undefined);
    if ("available" in out) setNote("Selling is not switched on here yet; a free listing works.");
  };

  /** A row's price draft differs from what it is listed at now. */
  const changed = (p: PublisherPack) => {
    const draft = prices[p.packId];
    if (draft === undefined) return false;
    return draft.trim() !== (p.price ? String(p.price.amount / 100) : "");
  };
  const changedPacks = (packs ?? []).filter(changed);

  const updateAll = () =>
    act("update-all", async () => {
      for (const p of changedPacks) await list(p);
    });

  return (
    <div className="publisherPacks">
      <h4 className="stepLabel">Your packs in the catalog</h4>
      {packs && packs.length > 0 && (
        <div className="padRow">
          <button className="ghost tiny" disabled={changedPacks.length === 0 || busy !== null} onClick={() => void updateAll()}>
            {busy === "update-all" ? "Updating…" : "Update all listings"}
          </button>
        </div>
      )}
      {packs === null ? (
        <p className="muted small">Reading…</p>
      ) : packs.length === 0 ? (
        <p className="muted small">Nothing uploaded yet. Pick a pack from this device's library below; sign it first if you want the badge.</p>
      ) : (
        packs.map((p) => {
          const priceText = p.status === "listed" ? (p.price ? priceDisplay(p.price) : "free") : "not listed";
          const isBusy = busy === p.packId || busy === "update-all";
          return (
            <div key={p.packId} className="row spread memberRow publisherPack">
              <span>
                <strong>{p.head.title}</strong>
                <span className="muted small">
                  {" "}
                  v{p.head.version} · {priceText}
                </span>
              </span>
              {confirmingRemove === p.packId ? (
                <span className="row">
                  <span className="warnText small">Remove {p.head.title} from the catalog?</span>
                  <button
                    className="ghost tiny danger"
                    disabled={isBusy}
                    onClick={() =>
                      void act(p.packId, async () => {
                        await api.deletePublisherPack(p.packId);
                        setConfirmingRemove(null);
                      })
                    }
                  >
                    Yes, remove it
                  </button>
                  <button className="ghost tiny" onClick={() => setConfirmingRemove(null)}>
                    Keep it
                  </button>
                </span>
              ) : (
                <span className="row">
                  {publisher.connectReady &&
                    (editing[p.packId] ? (
                      <input
                        className="textInput short"
                        inputMode="decimal"
                        placeholder="$ or blank"
                        autoFocus
                        value={prices[p.packId] ?? (p.price ? String(p.price.amount / 100) : "")}
                        onChange={(e) => setPrices({ ...prices, [p.packId]: e.target.value })}
                        aria-label={`Price for ${p.head.title}, in dollars`}
                      />
                    ) : (
                      <button className="ghost tiny" onClick={() => setEditing({ ...editing, [p.packId]: true })}>
                        edit
                      </button>
                    ))}
                  <button className="ghost tiny" disabled={isBusy} onClick={() => void act(p.packId, () => list(p))}>
                    {p.status === "listed" ? "Update listing" : "List"}
                  </button>
                  <details className="rowMenu">
                    <summary className="rowMenuBtn" aria-label={`More for ${p.head.title}`}>
                      …
                    </summary>
                    <div className="rowMenuPanel" role="menu">
                      {p.status === "listed" && (
                        <button role="menuitem" disabled={isBusy} onClick={() => void act(p.packId, async () => void (await api.unlistPublisherPack(p.packId)))}>
                          Unlist
                        </button>
                      )}
                      <button role="menuitem" onClick={() => setConfirmingRemove(p.packId)}>
                        Remove
                      </button>
                    </div>
                  </details>
                </span>
              )}
            </div>
          );
        })
      )}
      <div className="row">
        <select className="textInput" value={chosen} onChange={(e) => setChosen(e.target.value)} aria-label="A pack from this device to upload">
          <option value="">Upload a pack from this device…</option>
          {library.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} v{p.version}
            </option>
          ))}
        </select>
        <button className="ghost" disabled={!chosen || busy === "upload"} onClick={() => void act("upload", upload)}>
          Upload
        </button>
      </div>
      {!publisher.connectReady && <p className="muted small">A price needs payouts set up; until then a listing is free.</p>}
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}
