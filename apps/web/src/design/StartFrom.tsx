import { useEffect, useState } from "react";
import YAML from "yaml";
import { listPacks, type StoredPack } from "../storage/db.ts";
import { loadMarketplace, type MarketplaceEntry } from "../library/marketplace.ts";
import { remixable, remixOf } from "./remix.ts";
import { useHosted } from "../hosted/HostedProvider.tsx";

/**
 * Start a pack from one that exists.
 *
 * The packs in the library and the marketplace, each with what its license
 * says about being remixed. Those that allow it open as a new pack of
 * your own; those that do not are listed with the reason, because "why is
 * my pack not here" is a question the panel should answer itself. A sealed
 * copy never appears: its text is the one thing that must not be copied.
 */
interface Candidate {
  id: string;
  title: string;
  from: string;
  verdict: ReturnType<typeof remixable>;
  load: () => Promise<Record<string, unknown>>;
}

export function StartFrom({ onPick, onClose }: { onPick: (draft: Record<string, unknown>) => void; onClose: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const hosted = useHosted();
  const testing = hosted === null || hosted.features.testing;

  useEffect(() => {
    let live = true;
    void (async () => {
      const mine = (await listPacks()).filter((p) => !p.sealed);
      const marketplace = await loadMarketplace({ testing });
      const seen = new Set<string>();
      const out: Candidate[] = [];
      const push = (id: string, title: string, from: string, text: () => Promise<string>) => {
        if (seen.has(id)) return;
        seen.add(id);
        out.push({
          id,
          title,
          from,
          verdict: { ok: false, reason: "reading…" },
          load: async () => YAML.parse(await text()) as Record<string, unknown>,
        });
      };
      for (const p of mine) push(p.id, p.title, p.origin === "catalog" ? "your library, from the marketplace" : "your library", async () => p.source);
      for (const e of marketplace) push(e.id, e.title, "the marketplace", e.load);
      // The verdict needs the license, which needs the text; read them all,
      // since a handful of packs is what a library holds.
      for (const c of out) {
        try {
          const doc = await c.load();
          c.verdict = remixable(doc["license"] as Parameters<typeof remixable>[0]);
        } catch {
          c.verdict = { ok: false, reason: "it could not be read" };
        }
      }
      if (live) setCandidates(out);
    })();
    return () => {
      live = false;
    };
  }, [testing]);

  return (
    <section className="panel startFrom">
      <h3 className="sectionTitle">
        Start from a pack <span className="muted">where its license allows</span>
      </h3>
      {candidates === null && <p className="muted small">Reading your packs…</p>}
      {candidates?.length === 0 && <p className="muted small">Nothing here yet. Add a pack from the marketplace or load one from a file first.</p>}
      {candidates?.map((c) => (
        <div key={c.id} className="row spread memberRow">
          <span>
            <strong>{c.title}</strong>
            <span className="muted small"> · {c.from}</span>
            {!c.verdict.ok && <div className="muted small">Not this one: {c.verdict.reason}.</div>}
            {c.verdict.ok && c.verdict.attribution && <div className="muted small">Its license asks for credit; the notice will carry it.</div>}
            {c.verdict.ok && c.verdict.shareAlike && <div className="muted small">Share-alike: your pack keeps the same license.</div>}
          </span>
          <button
            className="ghost tiny"
            disabled={!c.verdict.ok || busy === c.id}
            onClick={() => {
              setBusy(c.id);
              void c
                .load()
                .then((doc) => onPick(remixOf(doc)))
                .finally(() => setBusy(null));
            }}
          >
            {busy === c.id ? "Opening…" : "Start from this"}
          </button>
        </div>
      ))}
      <button className="ghost tiny" onClick={onClose}>
        Close
      </button>
    </section>
  );
}

export type { StoredPack, MarketplaceEntry };
