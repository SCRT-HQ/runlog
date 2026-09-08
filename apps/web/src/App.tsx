import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DOC_KINDS,
  generateDoc,
  loadPackText,
  open as openSealed,
  readHeader,
  type DocKind,
  type ContainerHeader,
  type Diagnostic,
  type Pack,
  type Table,
} from "@runlog/rules-schema";
import { describeRoll, entryKeys, resolveRoll, type RollResult } from "./rolling.ts";
import { DiceTray } from "./dice/DiceTray.tsx";
import { RunView } from "./run/RunView.tsx";
import { DesignView } from "./design/DesignView.tsx";
import { ProfileView } from "./profile/ProfileView.tsx";
import { profileHash, profilePageFromHash, type ProfilePage } from "./profile/route.ts";
import { LibraryView, type LibraryPack } from "./library/LibraryView.tsx";
import { CatalogView } from "./library/CatalogView.tsx";
import { GuideView } from "./guide/GuideView.tsx";
import { guideSlugFromHash } from "./guide/pages.ts";
import { widgetFromHash, type WidgetRoute } from "./widget/route.ts";
import { WidgetView } from "./widget/WidgetView.tsx";
import { liveFromHash, type LiveRoute } from "./live/route.ts";
import { LiveRunView } from "./live/LiveRunView.tsx";
import { DocMenu } from "./docs/DocMenu.tsx";
import { DocView } from "./docs/DocView.tsx";
import { catalogEntry, LEGACY_IDS, loadCatalog, RENAMED_IDS, STARTER_PACK, updatesFor, type CatalogEntry } from "./library/catalog.ts";
import { markOpened, forgetOpened, openedAt } from "./library/opened.ts";
import { SignatureBadge } from "./signing/SignatureBadge.tsx";
import { IncomingPackBanner, useIncomingPack } from "./share/IncomingPack.tsx";
import { InviteBanner, useIncomingInvite } from "./share/IncomingInvite.tsx";
import { RaceBanner, rememberRaceCode, useIncomingRace } from "./share/IncomingRace.tsx";
import { PurchaseBanner, useIncomingPurchase, type PurchaseState } from "./share/IncomingPurchase.tsx";
import { purchaseFileByToken, type Purchase } from "./sync/client.ts";
import { keepPurchase, openPurchase } from "./sync/purchases.ts";
import { useApi } from "./sync/useApi.ts";
import { SealedPackPrompt } from "./share/SealedPackPrompt.tsx";
import { AccountBadge } from "./auth/AccountBadge.tsx";
import { Footer } from "./hosted/Footer.tsx";
import { useHosted } from "./hosted/HostedProvider.tsx";
import { countView } from "./hosted/beacon.ts";
import { baseOf, welcomePath } from "./welcome/route.ts";
import { TermsGate } from "./hosted/TermsGate.tsx";
import { NameGate } from "./auth/NameGate.tsx";
import { useAccount } from "./auth/Account.tsx";
import { createApi } from "./sync/client.ts";
import { apiBase } from "./sync/config.ts";
import { activeRunFor, forgetActive, lastActive, NEW_RUN, setActiveRunFor, setLastActive } from "./run/active.ts";
import { syncBus } from "./sync/bus.ts";
import { useSync } from "./sync/SyncProvider.tsx";
import YAML from "yaml";
import {
  forgetPack,
  forgetRunsFor,
  licensesToTry,
  listPacks,
  loadPack,
  loadRun,
  purgePack,
  saveLicense,
  savePack,
  type StoredPack,
  forgetRun,
  listRuns,
  runsFor,
  saveRun,
} from "./storage/db.ts";


/**
 * The app.
 *
 * It began as the tool that made the pack format tangible — load a pack
 * through the engine's own validator, show what is in it, roll on its tables
 * — and that inspector is still here, one view among three. Play runs the
 * game; Design writes the pack.
 *
 * Everything on screen is driven by pack data. There is no hardcoded "Room" or
 * "Track" anywhere below: switching packs re-labels the whole interface, which
 * is the clearest demonstration that the format is not secretly built around
 * one game.
 */

export default function App() {
  /**
   * The pack in play, or none. Nothing ships in the bundle any more: every
   * pack is in storage, so the first paint has no pack, and the one this
   * device remembered comes back the moment storage has answered. With
   * none in play, the library is the screen.
   */
  const [source, setSource] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string>("");
  /**
   * Packs the player imported from their own files.
   *
   * Kept locally so a private transcription of a rulebook survives a reload
   * without ever leaving the machine — before this, picking a file lasted
   * exactly as long as the tab did.
   */
  const [imported, setImported] = useState<StoredPack[]>([]);

  useEffect(() => {
    let first = true;
    const reload = () =>
      void listPacks().then(async (packs) => {
        if (first) {
          first = false;
          packs = await settleLibrary(packs);
        }
        setImported([...packs].sort((a, b) => a.title.localeCompare(b.title)));
        // The remembered pack, where it is one of these: chosen once, on
        // the first load, and not again on a pull.
        const wanted = rememberedPack();
        const mine = packs.find((p) => p.id === wanted && !p.deletedAt);
        if (mine) {
          setActiveId((current) => {
            if (current) return current;
            setSource(mine.source);
            return mine.id;
          });
        }
      });
    reload();
    // A pack that arrived from another device belongs on the shelf too.
    return syncBus.subscribe((news) => {
      if (news.t === "pulled" && news.kind === "pack") reload();
    });
  }, []);
  const [view, setView] = useState<"play" | "rules" | "design" | "profile" | "library" | "catalog" | "guide">("play");
  /**
   * Places that live in the address bar: the docs' page (`#guide/playing`
   * opens it and can be linked to), the Designer (`#create`), and the
   * profile's four pages (`#profile`, `#profile/publishing`, and so on).
   * Leaving any of them clears the hash; nothing else in the app lives there.
   */
  const [guideSlug, setGuideSlug] = useState<string>(() => guideSlugFromHash(typeof location !== "undefined" ? location.hash : "") ?? "start");
  /** A widget page: one panel of a run, alone, for a stream to capture. */
  const [widget, setWidget] = useState<WidgetRoute | null>(() => widgetFromHash(typeof location !== "undefined" ? location.hash : ""));
  /** A live link: one run, watched by anyone, alone on the page. */
  const [liveRoute, setLiveRoute] = useState<LiveRoute | null>(() => liveFromHash(typeof location !== "undefined" ? location.hash : ""));
  /** A pack the catalog opens on, from `#catalog/<packId>`: a live page's "in the catalog" link lands here. */
  const [catalogFocus, setCatalogFocus] = useState<string | null>(null);
  /** Which of the profile's four pages, from `#profile` or `#profile/<page>`. */
  const [profilePage, setProfilePage] = useState<ProfilePage>(() => profilePageFromHash(typeof location !== "undefined" ? location.hash : "") ?? "profile");
  useEffect(() => {
    const fromHash = () => {
      setWidget(widgetFromHash(location.hash));
      setLiveRoute(liveFromHash(location.hash));
      const slug = guideSlugFromHash(location.hash);
      if (slug) {
        setGuideSlug(slug);
        setView("guide");
      } else if (location.hash === "#create") {
        setView("design");
      } else if (/^#profile(\/|$)/.test(location.hash)) {
        setProfilePage(profilePageFromHash(location.hash) ?? "profile");
        setView("profile");
      } else if (/^#catalog(\/|$)/.test(location.hash)) {
        const id = location.hash.slice("#catalog/".length);
        setCatalogFocus(id ? decodeURIComponent(id) : null);
        setView("catalog");
        history.replaceState(null, "", location.pathname + location.search);
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const openGuide = (slug = guideSlug) => {
    setGuideSlug(slug);
    setView("guide");
    if (location.hash !== `#guide/${slug}`) history.replaceState(null, "", `#guide/${slug}`);
  };
  const leaveGuide = () => {
    setView("play");
    if (location.hash.startsWith("#guide")) history.replaceState(null, "", location.pathname + location.search);
  };
  const openDesigner = () => {
    setView("design");
    if (location.hash !== "#create") history.replaceState(null, "", "#create");
  };
  const leaveDesigner = () => {
    setView("play");
    if (location.hash === "#create") history.replaceState(null, "", location.pathname + location.search);
  };
  /**
   * Opening the profile, or moving between its pages, pushes a history
   * entry rather than replacing one: unlike the guide and the Designer, the
   * profile's four pages are meant to be steppable with Back.
   */
  const openProfile = (page: ProfilePage = "profile") => {
    setProfilePage(page);
    setView("profile");
    const hash = profileHash(page);
    if (location.hash !== hash) history.pushState(null, "", hash);
  };
  const leaveProfile = () => {
    setView("play");
    if (location.hash.startsWith("#profile")) history.replaceState(null, "", location.pathname + location.search);
  };

  /**
   * A pack someone shared in a link. Offered rather than opened: a link
   * replaces what you are looking at, and it can come from anyone.
   */
  const shared = useIncomingPack();

  /** Sync, where there is any: the shelf offers a pack's own switch through it. */
  const sync = useSync();
  const account = useAccount();
  const api = useApi();

  /** An invitation in the link, and the join it turns into. */
  const invited = useIncomingInvite();
  const raceLink = useIncomingRace();
  const bought = useIncomingPurchase();
  const [purchaseState, setPurchaseState] = useState<PurchaseState>({ kind: "waiting" });
  /** What the account has bought, for the catalog; read when the catalog opens. */
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  useEffect(() => {
    if (view !== "catalog" || !api) return;
    let live = true;
    void api.myPurchases().then((p) => live && setPurchases(p), () => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, api]);
  /** What a copy that arrived from a purchase is marked as, when it is kept. */
  const purchaseExtra = useRef<Partial<StoredPack>>({});
  const [joining, setJoining] = useState(false);
  /** A session just joined, to open the moment sync brings it. */
  const awaitingJoin = useRef<string | null>(null);

  /** A line under the bar when something asked for could not be done. */
  const [notice, setNotice] = useState<string | null>(null);

  /** A sealed copy waiting on its license key. */
  const [sealed, setSealed] = useState<{ data: Uint8Array; header: ContainerHeader } | null>(null);

  const result = useMemo(() => loadPackText(source ?? "", "yaml"), [source]);

  /**
   * The pack exactly as written, before the schema fills in defaults.
   *
   * A signature covers what the author signed, and they signed their file —
   * not the engine's normalized reading of it. Verifying the validated pack
   * would break every signature the moment a default changed.
   */
  const document = useMemo(() => {
    if (source === null) return null;
    try {
      return YAML.parse(source) as unknown;
    } catch {
      return null;
    }
  }, [source]);

  /**
   * The rules page rolls its tables to show what they do. Those rolls are
   * unseeded and go nowhere: a seed belongs to a run, and is set where one
   * starts.
   */
  const unseeded = () => Math.random;

  const choose = useCallback((id: string, src: string) => {
    setActiveId(id);
    setSource(src);
    rememberPack(id);
    markOpened(id);
  }, []);

  /**
   * Add a catalog pack to the library. Its text is public, so it syncs to
   * the account without the per-pack switch; on a second device it is
   * simply there.
   */
  const addFromCatalog = useCallback(async (id: string): Promise<StoredPack | null> => {
    const entry = await catalogEntry(id);
    if (!entry) return null;
    const text = await entry.load();
    const parsed = loadPackText(text, "yaml");
    if (!parsed.ok) return null;
    const at = new Date().toISOString();
    const record: StoredPack = {
      id: parsed.pack.id,
      title: parsed.pack.title,
      version: parsed.pack.version,
      source: text,
      format: "yaml",
      filename: `${entry.id}.yaml`,
      importedAt: at,
      updatedAt: at,
      sync: true,
      origin: entry.source === "listing" ? "listing" : "catalog",
      catalog: { id: entry.id, version: entry.version },
    };
    await savePack(record);
    syncBus.localChange("pack", record.id);
    setImported((prev) => [...prev.filter((p) => p.id !== record.id), record].sort((a, b) => a.title.localeCompare(b.title)));
    return record;
  }, []);

  /**
   * Open a run wherever it is: the pack it belongs to comes into play and
   * the run becomes the one this device has open for it. Says why, when the
   * pack is not here.
   */
  const openRun = useCallback(
    async (runId: string, quiet = false): Promise<boolean> => {
      const saved = await loadRun(runId);
      if (!saved || saved.deletedAt) return false;
      let mine = imported.find((p) => p.id === saved.packId);
      if (!mine) {
        // A catalog pack this device lacks is simply fetched: the run is
        // the player's, and the pack is free.
        const added = await addFromCatalog(saved.packId);
        if (added) mine = added;
      }
      const src = mine?.source;
      if (!src) {
        if (!quiet) setNotice(`Your latest run is on a pack that is not on this device (${saved.packTitle ?? saved.packId}). Load it from a file and it will open.`);
        return false;
      }
      setActiveRunFor(saved.packId, runId);
      setLastActive({ packId: saved.packId, runId });
      choose(saved.packId, src);
      setView("play");
      setNotice(null);
      return true;
    },
    [imported, choose, addFromCatalog],
  );

  /**
   * Continue where you left off: the run this device touched last, or, when
   * it has none, the one the account touched last on any device.
   */
  const continueLast = useCallback(
    async (quiet = false) => {
      const say = (text: string) => !quiet && setNotice(text);
      const here = lastActive();
      if (here && (await openRun(here.runId, quiet))) return;
      const base = apiBase();
      if (!base || account.status !== "signed-in") {
        say("Nothing to continue yet on this device.");
        return;
      }
      try {
        const me = await createApi(base, account.getAccessToken).me();
        const id = me.profile.currentSessionId;
        if (!id) {
          say("Your account has no run in progress yet.");
          return;
        }
        if (!(await openRun(id, quiet))) {
          // Not here yet: a pass brings it, and the next try opens it.
          sync.syncNow();
          say("Fetching your latest run. Try again in a moment.");
        }
      } catch {
        say("Could not reach your account just now.");
      }
    },
    [openRun, account, sync],
  );

  /**
   * A device with nothing open, signed in, after its first pass: open what
   * the account was on. Once, not on every pass, so browsing is left alone.
   */
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || account.status !== "signed-in" || sync.status !== "synced") return;
    if (lastActive()) {
      autoOpened.current = true;
      return;
    }
    autoOpened.current = true;
    // Quietly: nobody asked, so nothing is said if there is nothing to open.
    void continueLast(true);
  }, [account.status, sync.status, continueLast]);

  // One way in for both doors: the link's banner and the menu's list.
  const joinByToken = useCallback(
    async (token: string) => {
      if (!api) return;
      const { sessionId, alreadyIn } = await api.acceptInvite(token, account.status === "signed-in" ? account.user.email : undefined);
      awaitingJoin.current = sessionId;
      setNotice(alreadyIn ? "You are already in this run. Opening it…" : "Joined. Fetching the run…");
      if (!(await openRun(sessionId))) sync.syncNow();
    },
    [api, account, openRun, sync],
  );

  const join = useCallback(async () => {
    if (!api || !invited.invite) return;
    setJoining(true);
    try {
      await joinByToken(invited.invite.token);
      invited.clear();
    } catch (error) {
      setNotice(error instanceof Error && error.message ? error.message : "That invitation could not be accepted.");
    } finally {
      setJoining(false);
    }
  }, [api, invited, joinByToken]);

  // The joined session lands with the next pass; open it when it does.
  useEffect(
    () =>
      syncBus.subscribe((news) => {
        const id = awaitingJoin.current;
        if (!id || news.t !== "pulled" || news.kind !== "run" || !news.ids.includes(id)) return;
        awaitingJoin.current = null;
        void openRun(id).then((opened) => opened && setNotice(null));
      }),
    [openRun],
  );

  /**
   * Which of the packs here the catalog has moved past. Read once the
   * library is open and the catalog has loaded; a pack the player loaded
   * from a file is never offered anything.
   */
  const [updates, setUpdates] = useState<Map<string, CatalogEntry>>(() => new Map());
  useEffect(() => {
    if (view !== "library") return;
    let live = true;
    void loadCatalog().then((entries) => live && setUpdates(updatesFor(imported, entries)));
    return () => {
      live = false;
    };
  }, [view, imported]);

  /**
   * Take the catalog's newer version: the text and the version change, the
   * record's identity and its switches do not. Runs are untouched — every
   * event is stamped with the pack version it was played under, and the
   * reducer reads whatever pack is loaded now.
   */
  const updateFromCatalog = useCallback(async (record: StoredPack) => {
    const entry = updates.get(record.id) ?? (record.catalog ? await catalogEntry(record.catalog.id) : null);
    if (!entry) return;
    const at = new Date().toISOString();
    let next: StoredPack;
    if (record.sealed) {
      // A sealed copy is fetched through its purchase: the catalog's file
      // is not for a buyer, and the server seals the current master
      // under the same key on the way.
      if (!api) return;
      const packId = record.catalog?.id ?? record.id;
      const mine = purchases.length > 0 ? purchases : await api.myPurchases().catch(() => []);
      const purchase = mine.find((p) => p.packId === packId && p.status === "fulfilled" && p.key);
      if (!purchase) {
        setNotice("This copy's purchase is not on your account, so its update cannot be fetched.");
        return;
      }
      const got = await openPurchase(purchase, await api.purchaseFile(purchase.ref)).catch(() => null);
      if (!got) {
        setNotice("The new copy could not be fetched; try again in a little while.");
        return;
      }
      if (got.pack.version === record.version) {
        setNotice("The publisher's new version is not ready to fetch yet; try again in a little while.");
        return;
      }
      next = { ...record, title: got.pack.title, version: got.pack.version, source: got.text, format: "yaml", updatedAt: at, catalog: { id: packId, version: got.pack.version } };
    } else {
      const text = await entry.load();
      const parsed = loadPackText(text, "yaml");
      if (!parsed.ok) return;
      next = {
        ...record,
        title: parsed.pack.title,
        version: parsed.pack.version,
        source: text,
        format: "yaml",
        updatedAt: at,
        origin: "catalog",
        catalog: { id: entry.id, version: entry.version },
      };
    }
    await savePack(next);
    syncBus.localChange("pack", next.id);
    setImported((prev) => prev.map((p) => (p.id === next.id ? next : p)));
    if (activeId === next.id) setSource(next.source);
  }, [updates, activeId, api, purchases]);

  /** What the library lists: every pack in storage, whatever it came from. */
  const libraryPacks = useMemo<LibraryPack[]>(
    () =>
      imported.map((p) => ({
        id: p.id,
        title: p.title,
        sub: `${p.sealed ? "your sealed copy" : p.origin === "catalog" || p.origin === "listing" ? "from the catalog" : "from your file"}, v${p.version}`,
        source: p.source,
        record: p,
        ...(updates.has(p.id) ? { update: updates.get(p.id)!.version } : {}),
      })),
    [imported, updates],
  );

  /** The pack in play, its own title wherever it has one; absent with nothing loaded. */
  const activeTitle = source === null ? null : (imported.find((p) => p.id === activeId)?.title ?? (result.ok ? result.pack.title : "A pack that did not load"));

  /** Whether the library is what is on screen right now, whichever way it got there. */
  const onLibrary = view === "library" || (source === null && view !== "design" && view !== "profile" && view !== "guide");

  /**
   * A sealed copy, opened: keep it, and keep the key that opened it.
   *
   * The pack goes on the shelf like any other, marked sealed so its text
   * never travels. The key is filed under the pack's id, which is the first
   * moment the id is known — the clear header names the sale, not the pack.
   */
  const keepOpened = useCallback(async (doc: unknown, key: string, header: ContainerHeader) => {
    const extra = purchaseExtra.current;
    purchaseExtra.current = {};
    const text = YAML.stringify(doc, { lineWidth: 90 });
    setSource(text);
    setSealed(null);
    setView("play");
    const parsed = loadPackText(text, "yaml");
    if (!parsed.ok) {
      setActiveId("upload");
      return;
    }
    const at = new Date().toISOString();
    const record: StoredPack = {
      id: parsed.pack.id,
      title: parsed.pack.title,
      version: parsed.pack.version,
      source: text,
      format: "yaml",
      filename: header.title ?? parsed.pack.title,
      importedAt: at,
      updatedAt: at,
      sealed: true,
      ...extra,
    };
    await savePack(record);
    await saveLicense({
      packId: record.id,
      key,
      ...(header.ref ? { ref: header.ref } : {}),
      ...(header.title ? { title: header.title } : {}),
      updatedAt: at,
    });
    syncBus.localChange("license", record.id);
    setImported((prev) => [...prev.filter((p) => p.id !== record.id), record].sort((a, b) => a.title.localeCompare(b.title)));
    setActiveId(record.id);
    rememberPack(record.id);
  }, []);

  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) return;

    // A sealed copy is binary and needs a key before there is anything to
    // read, so it is caught before any attempt to parse it as text. A key
    // this browser (or this account) has seen is tried first; the prompt is
    // for a file none of them opens.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const header = readHeader(bytes);
    if (header) {
      for (const license of await licensesToTry(header)) {
        const result = await openSealed(bytes, license.key);
        if (result.ok) {
          await keepOpened(result.document, license.key, header);
          return;
        }
      }
      setSealed({ data: bytes, header });
      return;
    }

    const text = await file.text();
    const parsed = loadPackText(text, /\.ya?ml$/i.test(file.name) ? "yaml" : "json");
    setSource(text);

    // Only a pack that actually loads is worth keeping; storing a broken one
    // would put it in the picker forever with no way to tell why it fails.
    if (!parsed.ok) {
      setActiveId("upload");
      return;
    }
    const importedAt = new Date().toISOString();
    const record: StoredPack = {
      id: parsed.pack.id,
      title: parsed.pack.title,
      version: parsed.pack.version,
      source: text,
      format: /\.ya?ml$/i.test(file.name) ? "yaml" : "json",
      filename: file.name,
      importedAt,
      updatedAt: importedAt,
    };
    await savePack(record);
    setImported((prev) => [...prev.filter((p) => p.id !== record.id), record].sort((a, b) => a.title.localeCompare(b.title)));
    setActiveId(record.id);
    rememberPack(record.id);
  }, [keepOpened]);

  /**
   * A bought copy, fetched and opened. By the receipt's token it needs no
   * account and the key is typed from the mail (or is already here); as
   * the signed-in buyer the key comes with the purchase and the copy
   * opens by itself. Either way it is kept marked as a listing, so the
   * catalog can offer the newer version when there is one.
   */
  useEffect(() => {
    const incoming = bought.purchase;
    if (!incoming) return;
    let live = true;
    const base = apiBase();
    const arrive = async (bytes: Uint8Array, key: string | null, packId?: string, version?: string) => {
      const header = readHeader(bytes);
      if (!header) throw new Error("that is not a sealed pack");
      purchaseExtra.current = { origin: "listing", ...(packId ? { catalog: { id: packId, version: version ?? "" } } : {}) };
      const keys = key ? [{ key }] : await licensesToTry(header);
      for (const license of keys) {
        const result = await openSealed(bytes, license.key);
        if (result.ok) {
          await keepOpened(result.document, license.key, header);
          bought.clear();
          return;
        }
      }
      // No key opened it: ask, as for any sealed file.
      setSealed({ data: bytes, header });
      bought.clear();
    };
    const run = async () => {
      try {
        if (incoming.token && base) {
          setPurchaseState({ kind: "opening" });
          await arrive(await purchaseFileByToken(base, incoming.ref, incoming.token), null);
          return;
        }
        if (!api) {
          setPurchaseState({ kind: "signin" });
          return;
        }
        // Back from Checkout: the webhook lands in seconds; ask until it has.
        setPurchaseState({ kind: "waiting" });
        for (let tries = 0; live && tries < 30; tries++) {
          const purchase = await api.purchase(incoming.ref);
          if (!purchase) {
            setPurchaseState({ kind: "error", message: "That purchase is not this account's. Sign in as the account that bought it, or use the link in the receipt." });
            return;
          }
          if (purchase.status === "revoked") {
            setPurchaseState({ kind: "error", message: "This copy was revoked by its publisher." });
            return;
          }
          if (purchase.status === "fulfilled" && purchase.key) {
            setPurchaseState({ kind: "opening" });
            const pack = await catalogEntry(purchase.packId);
            await arrive(await api.purchaseFile(incoming.ref), purchase.key, purchase.packId, pack?.version);
            return;
          }
          await new Promise((r) => setTimeout(r, 3000));
        }
        if (live) setPurchaseState({ kind: "error", message: "The copy is taking longer than usual. The receipt mail has a link that fetches it, and it is on your profile under Purchases." });
      } catch (error) {
        if (live) setPurchaseState({ kind: "error", message: error instanceof Error && error.message ? error.message : "The copy could not be fetched." });
      }
    };
    void run();
    return () => {
      live = false;
    };
    // The purchase is what matters; the rest are stable for its life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bought.purchase, api]);

  const forget = useCallback(async (record: StoredPack) => {
    forgetOpened(record.id);
    // A sealed copy was never told to the server, so there is nobody to
    // tell about its deletion: it goes at once, no tombstone. The license
    // key stays — it is the receipt, and the file can be opened again.
    if (record.sealed) await purgePack(record.id);
    else await forgetPack(record.id);
    await forgetRunsFor(record.id);
    setImported((prev) => prev.filter((p) => p.id !== record.id));
    setActiveId((current) => {
      if (current !== record.id) return current;
      setSource(null);
      rememberPack("");
      return "";
    });
  }, []);

  // A hosted copy counts the screen, once per change; see hosted/beacon.ts
  // for what is and is not sent. Every hook above has run by here.
  const hosted = useHosted();
  useEffect(() => {
    countView(widget ? "widget" : liveRoute ? "live" : view, { hosted: hosted !== null, version: __RUNLOG_VERSION__ });
  }, [hosted, widget, liveRoute, view]);

  if (widget) return <WidgetView route={widget} />;
  if (liveRoute) {
    return (
      <>
      <LiveRunView
        route={liveRoute}
        onWatch={async (runId) => {
          // The seat is taken on the server; a pass brings the run, and it opens.
          sync.syncNow();
          for (let tries = 0; tries < 12; tries += 1) {
            await new Promise((r) => setTimeout(r, 1000));
            if (await loadRun(runId)) break;
          }
          history.replaceState(null, "", location.pathname + location.search);
          setLiveRoute(null);
          if (!(await openRun(runId, true))) {
            sync.syncNow();
            setNotice("Your seat is taken; the run is on its way and will be on your shelf in a moment.");
            setView("library");
          }
        }}
      />
      <Footer onGuide={() => location.assign("./#guide/streaming")} />
      </>
    );
  }

  // Where the mark goes: the welcome page, where there is one. Read once,
  // and only where there is a location to read (the tests render without).
  const home = typeof location !== "undefined" ? welcomePath(location.protocol, baseOf(location.href)) : null;

  return (
    <div className="app">
      <header className="topbar">
        {/* The mark goes home: the page that says what Runlog is, even for
            somebody who chose to skip it. From a file there is no such page,
            and the mark is the way to the shelf instead. */}
        <a
          className="brand"
          href={home ?? "./"}
          title="What Runlog is"
          onClick={(e) => {
            if (home) return;
            e.preventDefault();
            setView("library");
            if (location.hash) history.replaceState(null, "", location.pathname + location.search);
          }}
        >
          <img className="logo" src="./icon.svg" alt="" />
          <h1>Runlog</h1>
        </a>
        {/* One door to the library, always; a pack in play still says which one, in muted text beside it. */}
        <button className="packNow" onClick={() => setView("library")} title="Your packs and runs" aria-current={onLibrary ? "page" : undefined}>
          <span className="shelfLabel">Your packs</span>
          {!onLibrary && activeTitle !== null && <span className="muted packTitle">{activeTitle}</span>}
        </button>
        <div className="topbarEnd">
          {/*
            The pack's rules, as one button that says which way it goes.
            Play, Rules and the rest used to be three tabs on every screen;
            what a player needs on a phone is the run and one way to read
            the rules of what they are running.
          */}
          {source !== null && result.ok && (
            <button className="ghost rulesBtn" onClick={() => setView(view === "rules" ? "play" : "rules")}>
              {view === "rules" ? "Back to play" : "Rules"}
            </button>
          )}
          <button className="ghost createBtn" onClick={() => (view === "design" ? leaveDesigner() : openDesigner())} title="Write a pack of your own in the Designer">
            {view === "design" ? "Back to the app" : "Designer"}
          </button>
          <button className="ghost guideBtn" onClick={() => (view === "guide" ? leaveGuide() : openGuide())} title="How to use Runlog">
            {view === "guide" ? "Back to the app" : "Guide"}
          </button>
          <AccountBadge closeKey={view} onOpenProfile={(page) => openProfile(page)} />
        </div>
      </header>

      {notice && (
        <div className="notice underBar" role="status">
          <span>{notice}</span>
          <button className="ghost tiny" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {invited.invite && (
        <InviteBanner
          invite={invited.invite}
          packTitle={(id) => imported.find((p) => p.id === id)?.title ?? null}
          busy={joining}
          onJoin={() => void join()}
          onDismiss={invited.clear}
        />
      )}

      {raceLink.code && view !== "play" && <RaceBanner code={raceLink.code} onDismiss={raceLink.clear} />}
      {bought.purchase && <PurchaseBanner state={purchaseState} onDismiss={bought.clear} />}
      {bought.cancelled && (
        <div className="incoming">
          <div className="incomingWhat">
            <span>Nothing was charged.</span>
          </div>
          <div className="incomingActions">
            <button className="ghost" onClick={bought.clear}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <IncomingPackBanner
        incoming={shared.incoming}
        error={shared.error}
        onOpen={(doc) => {
          setActiveId("shared");
          setSource(YAML.stringify(doc, { lineWidth: 90 }));
          setView("play");
          shared.clear();
        }}
        onDismiss={shared.clear}
      />

      {result.ok && document !== null && (
        <SignatureBadge document={document} packId={result.pack.id} />
      )}

      {/* Design writes a pack of its own, so whether the *selected* pack
          loads has nothing to do with whether the editor can open. */}
      {sealed ? (
        <SealedPackPrompt
          data={sealed.data}
          header={sealed.header}
          onCancel={() => setSealed(null)}
          onOpened={(doc, key) => void keepOpened(doc, key, sealed.header)}
        />
      ) : view === "catalog" ? (
        <CatalogView
          focus={catalogFocus}
          mine={new Set(imported.map((p) => p.id))}
          bought={new Set(purchases.filter((p) => p.status === "fulfilled").map((p) => p.packId))}
          {...(api
            ? {
                onBuy: async (entry: CatalogEntry) => {
                  const out = await api.startPurchase(entry.id);
                  if ("url" in out) location.href = out.url;
                  else if ("owned" in out && out.owned) setNotice("You already own this pack; it is on your profile under Purchases.");
                  else setNotice("available" in out ? "Buying is not switched on here yet." : "That pack is not for sale just now.");
                },
                onFetch: async (entry: CatalogEntry) => {
                  const purchase = purchases.find((p) => p.packId === entry.id && p.status === "fulfilled" && p.key);
                  if (!purchase) return;
                  try {
                    const id = await keepPurchase({ savePack, saveLicense }, purchase, await api.purchaseFile(purchase.ref));
                    if (!id) {
                      setNotice("The copy could not be opened with its key; ask its publisher to send it again.");
                      return;
                    }
                    syncBus.localChange("license", id);
                    const record = await loadPack(id);
                    if (record) {
                      setImported((prev) => [...prev.filter((p) => p.id !== record.id), record].sort((a, b) => a.title.localeCompare(b.title)));
                      choose(record.id, record.source);
                    }
                  } catch (error) {
                    setNotice(error instanceof Error && error.message ? error.message : "The copy could not be fetched.");
                  }
                },
              }
            : {})}
          onAdd={async (entry) => {
            await addFromCatalog(entry.id);
          }}
          onOpen={(id) => {
            const p = imported.find((q) => q.id === id);
            if (p) {
              choose(p.id, p.source);
              setView("play");
            }
          }}
          onBack={() => setView("library")}
        />
      ) : onLibrary ? (
        <LibraryView
          packs={libraryPacks}
          activeId={activeId}
          onOpen={(p) => {
            choose(p.id, p.source);
            setView("play");
          }}
          onContinue={(p, r) => {
            setActiveRunFor(p.id, r.runId);
            setLastActive({ packId: p.id, runId: r.runId });
            choose(p.id, p.source);
            setView("play");
          }}
          onContinueLast={() => void continueLast()}
          onStartAnother={(p) => {
            setActiveRunFor(p.id, NEW_RUN);
            choose(p.id, p.source);
            setView("play");
          }}
          onForgetRun={(r) => {
            forgetActive(r.packId, r.runId);
            void forgetRun(r.runId).then(() => syncBus.localChange("run", r.runId));
          }}
          onForgetPack={(record) => void forget(record)}
          onFile={(file) => {
            setView("play");
            void onFile(file);
          }}
          onSyncToggle={(record, on) => {
            setImported((prev) => prev.map((q) => (q.id === record.id ? { ...q, sync: on } : q)));
            void sync.setPackSync(record.id, on);
          }}
          onCatalog={() => setView("catalog")}
          onUpdate={(record) => void updateFromCatalog(record)}
          {...(api
            ? {
                onJoinRace: async (code: string) => {
                  try {
                    const race = await api.joinRace(code);
                    rememberRaceCode(code);
                    const here = imported.find((p) => p.id === race.meta.packId);
                    if (!here) {
                      setNotice(`That race plays ${race.meta.packTitle ?? race.meta.packId}, which is not on your shelf. Add it from the catalog; the code is kept.`);
                      return;
                    }
                    setActiveRunFor(here.id, NEW_RUN);
                    choose(here.id, here.source);
                    setView("play");
                  } catch (error) {
                    setNotice(error instanceof Error && error.message ? error.message : "That code did not open a race.");
                  }
                },
              }
            : {})}
        />
      ) : view === "guide" ? (
        <GuideView slug={guideSlug} onNavigate={(slug) => openGuide(slug)} onBack={leaveGuide} />
      ) : view === "profile" ? (
        <ProfileView
          onBack={leaveProfile}
          page={profilePage}
          onNavigate={openProfile}
          onOpenRun={(runId) => void openRun(runId)}
          onJoinInvite={async (token) => {
            try {
              await joinByToken(token);
            } catch (error) {
              setNotice(error instanceof Error && error.message ? error.message : "That invitation could not be accepted.");
            }
          }}
        />
      ) : view === "design" ? (
        <DesignView />
      ) : !result.ok ? (
        <Diagnostics diagnostics={result.diagnostics} />
      ) : view === "play" ? (
        <RunView key={result.pack.id} pack={result.pack} />
      ) : (
        <PackView pack={result.pack} warnings={result.diagnostics} random={unseeded} />
      )}
      <Footer onGuide={() => openGuide()} />
      <TermsGate />
      <NameGate />
    </div>
  );
}

function Diagnostics({ diagnostics }: { diagnostics: Diagnostic[] }) {
  return (
    <main className="diagnostics">
      <h2>This pack did not load</h2>
      <p className="muted">
        The same three gates the engine uses: version, then shape, then coherence.
      </p>
      <ul>
        {diagnostics.map((d, i) => (
          <li key={i} className={d.level}>
            <span className="code">{d.code}</span>
            {d.path && <span className="path">{d.path}</span>}
            <p>{d.message}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}

/**
 * The pack, read.
 *
 * The paper first: the rulebook, the quick start, the reference card, the
 * run log sheet and the catalog summary, each written from the pack as it
 * is, since that is how a game is read at a table. The pack's structure —
 * every table, the flow, the modes, as the engine holds them — is the last
 * tab, for a designer or anyone checking a rule against its source.
 */
export function PackView({
  pack,
  warnings,
  random,
  initial = "rulebook",
}: {
  pack: Pack;
  warnings: Diagnostic[];
  random: () => () => number;
  /** Which tab opens first; the rulebook unless a test or a link says otherwise. */
  initial?: DocKind | "structure";
}) {
  const [tab, setTab] = useState<DocKind | "structure">(initial);
  const doc = useMemo(() => (tab === "structure" ? null : generateDoc(pack, tab)), [pack, tab]);
  return (
    <main className="main rulesView">
      <nav className="rulesTabs" aria-label="What to read">
        {DOC_KINDS.filter((k) => k.kind !== "summary").map((k) => (
          <button key={k.kind} className={`chip pick ${tab === k.kind ? "on" : ""}`} title={k.what} onClick={() => setTab(k.kind)}>
            {k.label}
          </button>
        ))}
        <button className={`chip pick ${tab === "summary" ? "on" : ""}`} title="What a catalog shows: the shape of the game without its rules." onClick={() => setTab("summary")}>
          Summary
        </button>
        <button className={`chip pick ${tab === "structure" ? "on" : ""}`} title="Every table, the flow, the modes, as the engine holds them" onClick={() => setTab("structure")}>
          Structure
        </button>
      </nav>
      {doc ? (
        <section className="panel docPage">
          <DocView doc={doc} heading />
        </section>
      ) : (
        <>
          <p className="muted small rulesNote">Rolls on this page are unseeded and not logged. A seed is set where a run starts.</p>
          <PackStructure pack={pack} warnings={warnings} random={random} />
        </>
      )}
    </main>
  );
}

function PackStructure({
  pack,
  warnings,
  random,
}: {
  pack: Pack;
  warnings: Diagnostic[];
  random: () => () => number;
}) {
  const v = pack.vocabulary;
  return (
    <>
      <section className="hero">
        <div>
          <h2>{pack.title}</h2>
          <p className="muted">{pack.description}</p>
          <div className="chips">
            <span className="chip v">v{pack.version}</span>
            <span className={`chip ${pack.license.redistributable ? "ok" : "warn"}`}>
              {pack.license.id}
              {!pack.license.redistributable && " · private"}
            </span>
            {pack.capabilities.map((c) => (
              <span key={c} className="chip cap">
                {c}
              </span>
            ))}
          </div>
          {pack.license.text && <pre className="licenseText">{pack.license.text}</pre>}
          {!pack.license.redistributable && (
            <p className="notice">
              Marked non-redistributable. Exports meant for other people carry roll results
              and references, never this pack&rsquo;s text.
            </p>
          )}
        </div>
        <dl className="vocab">
          <div>
            <dt>Run</dt>
            <dd>{v.run.one}</dd>
          </div>
          <div>
            <dt>Unit</dt>
            <dd>{v.unit.one}</dd>
          </div>
          <div>
            <dt>Subject</dt>
            <dd>{v.subject.one}</dd>
          </div>
          <div>
            <dt>Close</dt>
            <dd>{v.finalize}</dd>
          </div>
        </dl>
      </section>

      {warnings.length > 0 && (
        <section className="panel warnings">
          <h3>{warnings.length} warning(s)</h3>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>
                <span className="code">{w.code}</span> {w.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="columns">
        <div className="col wide">
          <h3 className="sectionTitle">Tables</h3>
          {Object.entries(pack.tables).map(([id, table]) => (
            <TableCard key={id} id={id} table={table} pack={pack} random={random} />
          ))}
        </div>

        <div className="col">
          <Flow pack={pack} />
          <Boxes pack={pack} />
        </div>
      </div>
    </>
  );
}

function TableCard({
  id,
  table,
  pack,
  random,
}: {
  id: string;
  table: Table;
  pack: Pack;
  random: () => () => number;
}) {
  const [open, setOpen] = useState(false);
  const [roll, setRoll] = useState<RollResult | null>(null);
  const [rollId, setRollId] = useState(0);
  /**
   * What the player is allowed to see yet.
   *
   * The result is decided the instant Roll is pressed, but revealing it while
   * the dice are still in the air gives the throw away. `revealed` lags behind
   * `roll` until the tray says the last die has stopped.
   */
  const [revealed, setRevealed] = useState<RollResult | null>(null);
  const keys = entryKeys(table);

  return (
    <section className={`panel table ${open ? "open" : ""}`}>
      <header onClick={() => setOpen((o) => !o)}>
        <div>
          <h4>
            {table.title} <span className="id">{id}</span>
          </h4>
          <p className="muted">{table.description}</p>
        </div>
        <div className="tableMeta">
          <span className="chip kind">{table.resolution}</span>
          <span className="dice">{describeRoll(table)}</span>
          <button
            className="roll"
            onClick={(e) => {
              e.stopPropagation();
              // The value is decided here, before anything moves. The tray
              // only ever settles onto a result that already exists.
              const result = resolveRoll(table, pack, random());
              setRoll(result);
              setRollId((n) => n + 1);
              setOpen(true);
              // A draw with no dice has nothing to wait for.
              setRevealed(result.dice.length === 0 ? result : null);
            }}
          >
            Roll
          </button>
        </div>
      </header>

      {roll && roll.dice.length > 0 && (
        <DiceTray dice={roll.dice} rollId={rollId} onSettled={() => setRevealed(roll)} />
      )}

      {revealed && (
        <div className="rollResult">
          <span className="headline">{revealed.headline}</span>
          {/* The derivation is always shown. A tool that hands you a verdict
              with no visible reasoning is the thing players distrust. */}
          <span className="working">{revealed.working}</span>
        </div>
      )}

      {open && (
        <ol className="entries">
          {table.entries.map((entry, i) => {
            const hit = revealed?.entryId === entry.id;
            return (
              <li key={entry.id} className={hit ? "hit" : ""}>
                <span className="key">{keys[i]}</span>
                <div>
                  {entry.title && <strong>{entry.title}</strong>}
                  <p>{entry.text}</p>
                  <div className="entryTags">
                    {entry.grants?.map((g) => (
                      <span key={g} className="chip state">
                        {pack.states?.[g]?.label ?? g}
                      </span>
                    ))}
                    {entry.triggers?.map((t, ti) => (
                      <span key={ti} className="chip trig">
                        {t.on}
                      </span>
                    ))}
                    {entry.requires && <span className="chip req">conditional</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Flow({ pack }: { pack: Pack }) {
  return (
    <section className="panel">
      <h3 className="sectionTitle">
        Flow <span className="muted">per {pack.vocabulary.unit.one.toLowerCase()}</span>
      </h3>
      <ol className="flow">
        {pack.phases.map((phase) => (
          <li key={phase.id}>
            <strong>{phase.label}</strong>
            {phase.skipWhen && <span className="chip skip">conditional</span>}
            <ul>
              {phase.steps.map((step, i) => (
                <li key={i} className="step">
                  <span className="chip kindSm">{step.kind}</span>
                  {"label" in step && step.label ? step.label : ""}
                  {step.kind === "rollTable" && (
                    <span className="muted"> → {pack.tables[step.table]?.title ?? step.table}</span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Boxes({ pack }: { pack: Pack }) {
  const states = Object.entries(pack.states ?? {});
  const counters = Object.entries(pack.counters ?? {});
  const resources = Object.entries(pack.resources ?? {});
  const decks = Object.entries(pack.decks ?? {});

  return (
    <>
      {resources.length > 0 && (
        <section className="panel">
          <h3 className="sectionTitle">Resources</h3>
          {resources.map(([id, r]) => (
            <div key={id} className="row">
              <strong>{r.label}</strong>
              <span className="muted">
                {r.initial} · {r.min}–{r.max ?? "∞"} · {r.display}
              </span>
            </div>
          ))}
        </section>
      )}

      {counters.length > 0 && (
        <section className="panel">
          <h3 className="sectionTitle">Counters</h3>
          {counters.map(([id, c]) => (
            <div key={id} className="row">
              <strong>{c.label}</strong>
              <span className="muted">
                {c.hidden && "hidden · "}
                {c.triggers?.length
                  ? `fires at ${c.triggers.map((t) => t.when.gte ?? t.when.eq).join(", ")}`
                  : "tally only"}
              </span>
            </div>
          ))}
        </section>
      )}

      {states.length > 0 && (
        <section className="panel">
          <h3 className="sectionTitle">States</h3>
          {states.map(([id, s]) => (
            <div key={id} className="row">
              <span className="chip state">{s.short ?? s.label}</span>
              <strong>{s.label}</strong>
              <span className="muted">{s.semantics?.join(", ") ?? "label only"}</span>
            </div>
          ))}
        </section>
      )}

      {decks.length > 0 && (
        <section className="panel">
          <h3 className="sectionTitle">Decks</h3>
          {decks.map(([id, d]) => (
            <div key={id} className="row">
              <strong>{d.title}</strong>
              <span className="muted">
                {d.kind === "cards" ? `${d.cards.length} cards` : "standard 52"} · draw{" "}
                {d.drawAtStart} at start
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="panel">
        <h3 className="sectionTitle">
          Targeting <span className="muted">how consequences reach back</span>
        </h3>
        <p className="muted small">
          {pack.targeting
            ? `${pack.targeting.strategy}`
            : "none — nothing in this game reaches backwards"}
        </p>
      </section>

      <section className="panel">
        <h3 className="sectionTitle">Modes</h3>
        {Object.entries(pack.modes).map(([id, m]) => (
          <div key={id} className="row">
            <strong>{m.label}</strong>
            <span className="muted">
              {m.units?.fixed
                ? `${m.units.fixed} fixed`
                : m.units?.roll
                  ? `roll ${m.units.roll}`
                  : m.units
                    ? `${m.units.min ?? "?"}–${m.units.max ?? "?"}`
                    : "open"}
              {m.seeded && " · seeded"}
              {(m.players?.max ?? 1) > 1 && ` · ${m.players?.max} players`}
            </span>
          </div>
        ))}
      </section>
    </>
  );
}

/**
 * The built-ins moved under the operator's domain. A pack stored under an
 * old id becomes the catalog's current copy under the new one, its runs
 * follow it, and the old record is forgotten (a tombstone, so the account
 * hears too). Idempotent: nothing is left under an old id to move twice.
 */
async function renameBuiltIns(packs: StoredPack[]): Promise<StoredPack[]> {
  const out: StoredPack[] = [];
  for (const p of packs) {
    const next = RENAMED_IDS[p.id];
    if (!next || p.deletedAt) {
      out.push(p);
      continue;
    }
    const entry = await catalogEntry(next);
    const text = entry ? await entry.load() : null;
    const parsed = text ? loadPackText(text, "yaml") : null;
    if (!entry || !text || !parsed?.ok) {
      out.push(p);
      continue;
    }
    const at = new Date().toISOString();
    const moved: StoredPack = {
      ...p,
      id: next,
      title: parsed.pack.title,
      version: parsed.pack.version,
      source: text,
      format: "yaml",
      filename: `${next}.yaml`,
      updatedAt: at,
      origin: "catalog",
      catalog: { id: next, version: entry.version },
    };
    await savePack(moved);
    for (const r of await runsFor(p.id)) await saveRun({ ...r, packId: next });
    const active = activeRunFor(p.id);
    if (active) setActiveRunFor(next, active);
    const opened = openedAt(p.id);
    if (opened) markOpened(next, opened);
    await forgetPack(p.id);
    syncBus.localChange("pack", next);
    syncBus.localChange("pack", p.id);
    if (!out.some((q) => q.id === next)) out.push(moved);
  }
  return out;
}

/* ---- which pack is in play on this device ------------------------------- */

const PACK_KEY = "runlog:pack";

function rememberedPack(): string | null {
  try {
    const id = localStorage.getItem(PACK_KEY);
    // The header shelf's short names for the built-ins, from before the catalog.
    return id ? (LEGACY_IDS[id] ?? id) : null;
  } catch {
    return null;
  }
}

/**
 * The library on first load: what should be there that is not.
 *
 * A device that played a built-in before the catalog has runs for a pack
 * it no longer has in the bundle; each such pack is added from the
 * catalog so the runs have their pack. A device with nothing at all gets
 * the starter pack once, so Play works before anyone has read anything.
 */
async function settleLibrary(packs: StoredPack[]): Promise<StoredPack[]> {
  packs = await renameBuiltIns(packs);
  const have = new Set(packs.map((p) => p.id));
  const wanted = new Set<string>();
  for (const r of await listRuns()) if (!r.deletedAt && !have.has(r.packId)) wanted.add(r.packId);
  const remembered = rememberedPack();
  if (remembered && !have.has(remembered)) wanted.add(remembered);
  let seeded = false;
  try {
    seeded = localStorage.getItem("runlog:seeded") === "yes";
  } catch {
    seeded = true;
  }
  if (packs.length === 0 && wanted.size === 0 && !seeded) wanted.add(STARTER_PACK);
  const added: StoredPack[] = [];
  for (const id of wanted) {
    const entry = await catalogEntry(id);
    if (!entry) continue;
    const text = await entry.load();
    const parsed = loadPackText(text, "yaml");
    if (!parsed.ok) continue;
    const at = new Date().toISOString();
    const record: StoredPack = {
      id: parsed.pack.id, title: parsed.pack.title, version: parsed.pack.version, source: text, format: "yaml",
      filename: `${entry.id}.yaml`, importedAt: at, updatedAt: at, sync: true, origin: "catalog", catalog: { id: entry.id, version: entry.version },
    };
    await savePack(record);
    added.push(record);
  }
  try {
    localStorage.setItem("runlog:seeded", "yes");
  } catch {
    /* fine */
  }
  return [...packs, ...added];
}

function rememberPack(id: string): void {
  try {
    // "upload" is a pack that did not load: nothing to come back to.
    if (id === "upload") localStorage.removeItem(PACK_KEY);
    else localStorage.setItem(PACK_KEY, id);
  } catch {
    /* a private window: the choice lasts the tab */
  }
}
