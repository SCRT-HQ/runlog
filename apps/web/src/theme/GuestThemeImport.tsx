import { parseThemeRecord } from "@runlog/themes";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount } from "../auth/Account.tsx";
import { useFocusTrap } from "../ui/useFocusTrap.ts";
import { newThemeId } from "./sync/ids.ts";
import { useThemes } from "./ThemeProvider.tsx";
import { openThemeRepository, type SavedThemeRow } from "./themeStorage.ts";

export const guestImportKey = (accountId: string) => `runlog:themes:guest-import:${accountId}`;

function readOffered(accountId: string): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(guestImportKey(accountId)) ?? "null") as {
      schemaVersion?: unknown;
      offered?: unknown;
    } | null;
    return new Set(
      value?.schemaVersion === 1 && Array.isArray(value.offered) ? value.offered.filter((v): v is string => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
}
function writeOffered(accountId: string, ids: Iterable<string>): void {
  try {
    localStorage.setItem(guestImportKey(accountId), JSON.stringify({ schemaVersion: 1, offered: [...new Set(ids)].sort() }));
  } catch {
    // A private window: the prompt may come back next time, which is harmless.
  }
}

async function guestLibrary(): Promise<readonly SavedThemeRow[]> {
  const list = (globalThis.indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }).databases;
  if (typeof list === "function") {
    const names = (await list.call(globalThis.indexedDB)).map((d) => d.name);
    if (!names.includes("runlog:anon:themes")) return [];
  }
  const repo = await openThemeRepository({ kind: "anon" });
  try {
    return await repo.listLibrary();
  } finally {
    repo.close();
  }
}

function anotherModalOpen(own: HTMLElement | null): boolean {
  return [...document.querySelectorAll('[aria-modal="true"]')].some((el) => el !== own);
}

/** One question after sign-in, never an automatic upload: which of this device's guest themes to copy into the account. */
export function GuestThemeImport(): ReactNode {
  const account = useAccount();
  const themes = useThemes();
  const accountId = account.status === "signed-in" ? account.user.id : null;
  const [offer, setOffer] = useState<{ accountId: string; rows: readonly SavedThemeRow[] } | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [blocked, setBlocked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const panel = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setOffer(null);
    if (accountId === null || themes.status !== "ready") return;
    let live = true;
    void guestLibrary()
      .then((rows) => {
        if (!live) return;
        const offered = readOffered(accountId);
        const fresh = rows.filter((r) => !offered.has(r.id));
        if (fresh.length === 0) return;
        setOffer({ accountId, rows: fresh });
        setChosen(new Set(fresh.map((r) => r.id)));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [accountId, themes.status, themes.scopeKey]);

  useEffect(() => {
    if (offer === null) return;
    const check = () => setBlocked(anotherModalOpen(panel.current));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-modal"] });
    return () => observer.disconnect();
  }, [offer]);

  const open = offer !== null && offer.accountId === accountId && !blocked;
  const remember = (ids: Iterable<string>) => {
    if (offer !== null) writeOffered(offer.accountId, [...readOffered(offer.accountId), ...ids]);
  };
  // Closing by either button, or Escape, marks every offered theme as asked about: the prompt is one-time.
  const close = () => {
    if (offer === null) return;
    remember(offer.rows.map((r) => r.id));
    setOffer(null);
  };
  useFocusTrap(panel, open, close);
  if (!open) return null;

  const importChosen = async () => {
    setBusy(true);
    setProblem(null);
    const left: SavedThemeRow[] = [];
    for (const row of offer.rows) {
      if (!chosen.has(row.id)) {
        left.push(row);
        continue;
      }
      const copy = parseThemeRecord({ ...row.record, id: newThemeId(), contentRevision: 1 });
      let done = false;
      if (copy.ok && account.status === "signed-in" && account.user.id === offer.accountId) {
        try {
          // A stale saveTheme (the account changed) throws: nothing lands in the next account.
          done = (await themes.saveTheme({ record: copy.value, expectedLocalRevision: null })).ok;
        } catch {
          done = false;
        }
      }
      // Each import is remembered as it lands, so pressing Import again never copies it twice.
      if (done) remember([row.id]);
      else left.push(row);
    }
    setBusy(false);
    if (!left.some((r) => chosen.has(r.id))) {
      close();
      return;
    }
    setOffer({ accountId: offer.accountId, rows: left });
    setProblem("Some themes could not be imported. They are still on this device.");
  };

  return (
    <div className="veil" role="presentation">
      <section ref={panel} className="panel confirmDialog" role="dialog" aria-modal="true" aria-labelledby="guestThemesTitle" tabIndex={-1}>
        <h2 id="guestThemesTitle">Add your themes to this account?</h2>
        <p className="muted small">These were saved on this device before you signed in. The originals stay here.</p>
        <ul>
          {offer.rows.map((row) => (
            <li key={row.id}>
              <label>
                <input
                  type="checkbox"
                  checked={chosen.has(row.id)}
                  onChange={() =>
                    setChosen((before) => {
                      const next = new Set(before);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                />{" "}
                {row.record.name}
              </label>
            </li>
          ))}
        </ul>
        {problem && (
          <p role="alert" className="dangerText">
            {problem}
          </p>
        )}
        <div className="padRow confirmActions">
          <button type="button" className="primary" disabled={busy || chosen.size === 0} onClick={() => void importChosen()}>
            {busy ? "Importing…" : "Import"}
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={close}>
            Not now
          </button>
        </div>
      </section>
    </div>
  );
}
