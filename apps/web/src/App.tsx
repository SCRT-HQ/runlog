import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
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
import { memoryRunStore, type RunStore } from "./run/store.ts";
import { DesignView } from "./design/DesignView.tsx";
import { ProfileView } from "./profile/ProfileView.tsx";
import { profileHash, type ProfilePage } from "./profile/route.ts";
import { LibraryView, type LibraryPack } from "./library/LibraryView.tsx";
import { formatOf, keptFromFile, notThisPack, replacedNotice } from "./library/replace.ts";
import { MarketplaceView } from "./library/MarketplaceView.tsx";
import { GuideView } from "./guide/GuideView.tsx";
import type { WidgetRoute } from "./widget/route.ts";
import type { DockRoute } from "./dock/route.ts";
import { stashLink } from "./connections/route.ts";
import { WidgetView } from "./widget/WidgetView.tsx";
import { useTitle } from "./title.ts";
import type { LiveRoute } from "./live/route.ts";
import { welcomePath } from "./welcome/route.ts";
import { addressForPlay, addressOf, goTo, linkTo, packToPlayFromHash } from "./route.ts";
import { landingNow, landingOf, type Landing, type View } from "./landing.ts";
import { LiveRunView } from "./live/LiveRunView.tsx";
import { SeatRunView } from "./live/SeatRunView.tsx";
import { DocMenu } from "./docs/DocMenu.tsx";
import { DocView } from "./docs/DocView.tsx";
import {
  marketplaceEntry,
  LEGACY_IDS,
  loadMarketplace,
  RENAMED_IDS,
  STARTER_PACK,
  updatesFor,
  type MarketplaceEntry,
} from "./library/marketplace.ts";
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
import { SettingsDialog } from "./run/SettingsDialog.tsx";
import { useAlertSettings } from "./alerts/useAlerts.ts";
import { Footer } from "./hosted/Footer.tsx";
import { useHosted } from "./hosted/HostedProvider.tsx";
import { countView } from "./hosted/beacon.ts";
import { useDocDrawer, type DocsAt } from "./docs/DocDrawer.tsx";
import { Button } from "./ui/Button.tsx";
import { TermsGate } from "./hosted/TermsGate.tsx";
import { NameGate } from "./auth/NameGate.tsx";
import { useAccount } from "./auth/Account.tsx";
import { createApi } from "./sync/client.ts";
import { apiBase } from "./sync/config.ts";
import { activeRunFor, forgetActive, lastActive, NEW_RUN, setActiveRunFor, setLastActive } from "./run/active.ts";
import { syncBus } from "./sync/bus.ts";
import { useSync } from "./sync/SyncProvider.tsx";
import { usePlan } from "./sync/usePlan.ts";
import { useProfileReturn } from "./profile/useProfileReturn.ts";
import { ThemeStudio } from "./theme/ThemeStudio.tsx";
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
  type StoredRun,
  forgetRun,
  listRuns,
  runsFor,
  saveRun,
} from "./storage/db.ts";

/**
 * The app.
 *
 * It began as the tool that made the pack format tangible, load a pack
 * through the engine's own validator, show what is in it, roll on its tables
 * - and that inspector is still here, one view among three. Play runs the
 * game; Design writes the pack.
 *
 * Everything on screen is driven by pack data. There is no hardcoded "Room" or
 * "Track" anywhere below: switching packs re-labels the whole interface, which
 * is the clearest demonstration that the format is not secretly built around
 * one game.
 */

/**
 * The width below which the bar cannot hold every door.
 *
 * The mark, the way back to the run, the shelf and the menu fill a phone's
 * row on their own. Create and Guide go under the menu below this, and
 * stand in the row above it. Measured rather than guessed: at 320 the five
 * controls wrap to a second row, and at 390 they clear it by a dozen
 * pixels, which a signed-in name in the menu would spend.
 */
const NARROW_BAR = "(max-width: 420px)";

/** Whether the bar is standing at a width it cannot hold every door at. */
function useNarrowBar(): boolean {
  const ask = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW_BAR).matches;
  const [narrow, setNarrow] = useState(ask);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW_BAR);
    const read = () => setNarrow(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);
  return narrow;
}

export default function App() {
  /**
   * The address this page was opened at, read before anything is drawn.
   *
   * Every piece of state the address decides starts from this, so the first
   * commit already agrees with the bar. It used to be decided in the effect
   * below, one commit late, and in that commit the run view still believed
   * it was the run and wrote its own address over the one just read: a cold
   * load of `/marketplace/<id>` drew the pack's page and left `#packs` in
   * the bar, and the next reload landed on the shelf. Read once: the
   * effect below reads the address again on every later change.
   */
  const [landed] = useState(landingNow);
  /**
   * The pack in play, or none. Nothing ships in the bundle any more: every
   * pack is in storage, so the first paint has no pack, and the one this
   * device remembered comes back the moment storage has answered. With
   * none in play, the library is the screen.
   */
  const [source, setSource] = useState<string | null>(null);
  /** A pack's paper asked for by address, held until the pack is in hand. */
  const [wantedDocs, setWantedDocs] = useState<{ at: DocsAt; kind: DocKind } | null>(landed.docs ?? null);
  const [activeId, setActiveId] = useState<string>("");
  /**
   * Packs the player imported from their own files.
   *
   * Kept locally so a private transcription of a rulebook survives a reload
   * without ever leaving the machine, before this, picking a file lasted
   * exactly as long as the tab did.
   */
  const [imported, setImported] = useState<StoredPack[]>([]);

  /**
   * Whether this copy's bundled marketplace includes the test bench: a static,
   * local or self-hosted copy has no `hosted.json` at all and always does;
   * a hosted one answers with its own `features.testing`, on in dev and off
   * in production. Declared early so every `loadMarketplace` call below can
   * read it, not just the hosted-words effect further down.
   */
  const hosted = useHosted();
  const marketplaceTesting = hosted === null || hosted.features.testing;

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
  const [view, setView] = useState<View>(landed.view ?? "play");
  const leaveGuardRef = useRef<(() => Promise<boolean>) | null>(null);
  const navigationGenerationRef = useRef(0);
  const acceptedDocumentDepartureRef = useRef(false);
  const themeAddressRef = useRef(`${location.pathname}${location.search}${location.hash}`);
  const [themeGuardActive, setThemeGuardActive] = useState(false);
  const registerThemeLeaveGuard = useCallback((guard: (() => Promise<boolean>) | null) => {
    leaveGuardRef.current = guard;
    setThemeGuardActive(guard !== null);
  }, []);
  const requestNavigation = useCallback((navigate: () => void): Promise<boolean> => {
    const generation = ++navigationGenerationRef.current;
    const guard = leaveGuardRef.current;
    if (guard === null) {
      navigate();
      return Promise.resolve(true);
    }
    return guard().then(
      (accepted) => {
        if (!accepted || navigationGenerationRef.current !== generation) return false;
        navigate();
        return true;
      },
      () => false,
    );
  }, []);
  useEffect(() => {
    if (!themeGuardActive) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (acceptedDocumentDepartureRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [themeGuardActive]);
  // This device's settings, opened from the account menu on any page. In a
  // run the same sheet is behind the run's own Settings button, with the
  // streaming tab; here it has only the device tab, which needs no run.
  /**
   * A pack on the bench: played in a store that forgets, from the Designer
   * (a draft, valid but unsaved) or the library (a pack, to see how it
   * plays). Nothing is written, and a draft that shares an id with a real
   * pack never touches that pack's runs.
   */
  const [bench, setBench] = useState<{ pack: Pack; from: "the Designer" | "the library"; store: RunStore } | null>(null);
  const openBench = (pack: Pack, from: "the Designer" | "the library") => setBench({ pack, from, store: memoryRunStore() });
  // Leaving the screen the bench was opened from puts the pack down too:
  // a trial does not wait behind another page to be found later.
  useEffect(() => setBench(null), [view]);
  const [alerts, setAlerts] = useAlertSettings();
  /**
   * Places that live in the address bar: the docs' page (`#guide/playing`
   * opens it and can be linked to), the Designer (`#create`), and the
   * profile's four pages (`#profile`, `#profile/publishing`, and so on).
   * Leaving any of them clears the hash; nothing else in the app lives there.
   */
  const [guideSlug, setGuideSlug] = useState<string>(landed.guide?.slug ?? "start");
  /** A section within the guide's page, from `#guide/<slug>/<section>`; the page scrolls to it. */
  const [guideSection, setGuideSection] = useState<string | null>(landed.guide?.section ?? null);
  /** A widget page: one panel of a run, alone, for a stream to capture. */
  const [widget, setWidget] = useState<WidgetRoute | null>(landed.widget);
  /** A dock: one run's remote, alone on the page, for a streaming app's custom browser dock. */
  const [dock, setDock] = useState<DockRoute | null>(landed.dock);
  /** A live link: one run, watched by anyone, alone on the page. */
  const [liveRoute, setLiveRoute] = useState<LiveRoute | null>(landed.live);
  /** The pack whose page the marketplace is showing, from `#marketplace/<packId>`: a live page's "in the marketplace" link lands here. */
  const [marketplaceFocus, setMarketplaceFocus] = useState<string | null>(landed.marketplaceFocus ?? null);
  /** Which of the profile's four pages, from `#profile` or `#profile/<page>`. */
  const [profilePage, setProfilePage] = useState<ProfilePage>(landed.profilePage ?? "profile");
  /** A run named in the address (`#run/<id>`, `/play/run/<id>`), waiting to be opened once the packs and storage are here. */
  const [wantedRun, setWantedRun] = useState<string | null>(landed.run ?? null);
  /** A run this account plays without holding its pack: the watcher's page with a strip. */
  const [seatRoute, setSeatRoute] = useState<string | null>(landed.seat);
  /**
   * How many play the run drawn from a seat, off its own record on the
   * shelf: the strip draws the table's actions only where a seat takes
   * them. Nought until the record arrives, which for a run this account
   * was invited to means the next pass of sync, so this looks again until
   * it has it and then leaves the shelf alone.
   */
  const [seatPlayers, setSeatPlayers] = useState(0);
  /** The runs this device keeps, for the shelf's seats: the ones this account plays and holds no pack for. */
  const [runRecords, setRunRecords] = useState<StoredRun[]>([]);
  const applyLanding = useCallback((at: Landing) => {
    setWidget(at.widget);
    setDock(at.dock);
    setLiveRoute(at.live);
    setSeatRoute(at.seat);
    if (at.guide) {
      setGuideSlug(at.guide.slug);
      setGuideSection(at.guide.section);
    }
    if (at.profilePage) setProfilePage(at.profilePage);
    if (at.link) {
      stashLink(at.link);
      goTo(profileHash(at.profilePage ?? "social"));
    }
    if (at.docs) setWantedDocs(at.docs);
    if (at.marketplaceFocus !== undefined) setMarketplaceFocus(at.marketplaceFocus);
    if (at.run) setWantedRun(at.run);
    if (at.view) setView(at.view);
  }, []);

  useEffect(() => {
    let live = true;
    let again = 0;
    const read = () =>
      void listRuns().then(
        (all) => {
          if (!live) return;
          setRunRecords(all.filter((r) => !r.deletedAt));
          const record = seatRoute ? all.find((r) => r.runId === seatRoute) : undefined;
          if (!record) return;
          setSeatPlayers((record.members ?? []).filter((m) => m.role === "owner" || m.role === "player").length);
          window.clearInterval(again);
        },
        () => {},
      );
    read();
    // A seated run's record arrives with a pass of sync, which is why this
    // looks again until it has the one it is drawing, and then leaves the
    // shelf alone. Elsewhere a written run says so on the bus.
    if (seatRoute) again = window.setInterval(read, 10_000);
    const off = syncBus.subscribe((news) => {
      if ((news.t === "localChange" || news.t === "pulled") && news.kind === "run") read();
    });
    return () => {
      live = false;
      window.clearInterval(again);
      off();
    };
  }, [seatRoute]);
  useEffect(() => {
    /**
     * The address, in either spelling, applied to the app.
     *
     * The same read as the one the first render was built from, so a
     * change of address lands where a load at that address would have.
     * What the address says nothing about is left as it is.
     */
    const fromAddress = () => {
      const destination = `${location.pathname}${location.search}${location.hash}`;
      const at = landingOf(addressOf(location));
      if (leaveGuardRef.current === null) {
        if (at.view === "themes") themeAddressRef.current = destination;
        applyLanding(at);
        return;
      }
      if (destination === themeAddressRef.current) return;

      const captured = new URL(destination, location.href);
      history.replaceState(null, "", themeAddressRef.current);
      void requestNavigation(() => {
        history.replaceState(null, "", `${captured.pathname}${captured.search}${captured.hash}`);
        const capturedLanding = landingOf(addressOf(captured));
        if (capturedLanding.view === "themes") {
          themeAddressRef.current = `${captured.pathname}${captured.search}${captured.hash}`;
        }
        applyLanding(capturedLanding);
      });
    };
    fromAddress();
    window.addEventListener("hashchange", fromAddress);
    window.addEventListener("popstate", fromAddress);
    return () => {
      window.removeEventListener("hashchange", fromAddress);
      window.removeEventListener("popstate", fromAddress);
    };
  }, [applyLanding, requestNavigation]);
  const openGuide = (slug = guideSlug, section?: string) => {
    void requestNavigation(() => {
      setGuideSlug(slug);
      setGuideSection(section ?? null);
      setView("guide");
      goTo(section ? `#guide/${slug}/${section}` : `#guide/${slug}`);
    });
  };
  /**
   * The way back from a section: the run, or the shelf where no pack is
   * loaded, since the address should name what is on screen either way.
   */
  const backToPlay = (from: RegExp) => {
    void requestNavigation(() => {
      setView("play");
      if (from.test(addressOf(location))) goTo(source === null ? "#packs" : "#play");
    });
  };
  const leaveGuide = () => backToPlay(/^#guide/);

  /**
   * The address says what is on screen, for the run as for every section.
   *
   * Each section writes its own address on the way in. The run did not:
   * it is reached from a dozen places that all say `setView("play")` and
   * none of them said where that was, so a run started from the shelf
   * left `/packs` in the bar and a reload went back to the shelf. This
   * is the one rule rather than a `goTo` beside each of them, because
   * the next one added would have been the next one to forget.
   *
   * Only over another section's address. A run that named itself keeps
   * its name, and anything that is not a section at all -- a shared
   * pack, a race code, a widget -- is left alone: the run view has
   * nothing better to say than what is already there.
   */
  useEffect(() => {
    if (view !== "play") return;
    const wanted = addressForPlay(addressOf(location), source !== null);
    if (wanted) goTo(wanted);
  }, [view, source]);
  /**
   * The shelf, and the address bar saying so.
   *
   * It was the app's bare address for a while, which meant going there
   * wrote `play` over wherever you had been, and the address named the run
   * while the shelf was on screen. It is a section like the rest now.
   */
  const openLibrary = useCallback(() => {
    void requestNavigation(() => {
      setView("library");
      goTo("#packs");
    });
  }, [requestNavigation]);

  /**
   * The marketplace. It has always been read from the address on the way in,
   * `#marketplace` and `#marketplace/<packId>`, and never written there on the way
   * out, so opening it from the shelf and reloading landed back on the
   * shelf.
   */
  const openMarketplace = useCallback(() => {
    void requestNavigation(() => {
      setView("marketplace");
      setMarketplaceFocus(null);
      goTo("#marketplace");
    });
  }, [requestNavigation]);

  /**
   * A pack's page in the marketplace, or the catalog with null.
   *
   * The address is what says which of the two is showing, so it is written
   * here and the view reads it back. Opening a page is pushed, because
   * browser back out of a pack should be the catalog it was opened from;
   * going back to the catalog replaces, so the page just left is not
   * sitting one Back away waiting to be opened again.
   */
  const openMarketplacePack = useCallback((id: string | null) => {
    setMarketplaceFocus(id);
    goTo(id ? `#marketplace/${encodeURIComponent(id)}` : "#marketplace", id ? "push" : "replace");
  }, []);

  const openDesigner = () => {
    void requestNavigation(() => {
      setView("design");
      goTo("#create");
    });
  };
  /**
   * The way back to the run, from whichever section the bar is standing in.
   *
   * Showing the run is all it does. The address follows from the effect
   * above, which is the one place that knows which addresses are a
   * section's and what the run should be wearing instead; a second list
   * here would be a second answer to the same question.
   */
  const returnToRun = () => void requestNavigation(() => setView("play"));
  /**
   * Opening the profile, or moving between its pages, pushes a history
   * entry rather than replacing one: unlike the guide and the Designer, the
   * profile's four pages are meant to be steppable with Back.
   */
  const openProfile = (page: ProfilePage = "profile", how: "push" | "replace" = "push") => {
    void requestNavigation(() => {
      setProfilePage(page);
      setView("profile");
      goTo(profileHash(page), how);
    });
  };
  const leaveProfile = () => backToPlay(/^#profile/);
  const openThemes = () => {
    void requestNavigation(() => {
      setView("themes");
      goTo("#themes");
      themeAddressRef.current = `${location.pathname}${location.search}${location.hash}`;
    });
  };
  const leaveThemes = () => backToPlay(/^#themes/);

  const onShellClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (
      leaveGuardRef.current === null ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(target instanceof HTMLAnchorElement) || target.hasAttribute("download")) return;
    if (target.target !== "" && target.target !== "_self") return;
    const destination = new URL(target.href, location.href);
    if (destination.href === location.href) return;

    event.preventDefault();
    event.stopPropagation();
    void requestNavigation(() => {
      if (destination.origin !== location.origin) {
        acceptedDocumentDepartureRef.current = true;
        location.assign(destination.href);
        return;
      }
      const address = addressOf(destination);
      const at = landingOf(address);
      const inApp =
        address !== "" &&
        (at.view !== undefined || at.widget !== null || at.dock !== null || at.live !== null || at.seat !== null || at.run !== undefined);
      if (!inApp) {
        acceptedDocumentDepartureRef.current = true;
        location.assign(destination.href);
        return;
      }
      history.pushState(null, "", `${destination.pathname}${destination.search}${destination.hash}`);
      applyLanding(at);
    });
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
  /** What the account has bought, for the marketplace; read when the marketplace opens. */
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  useEffect(() => {
    if (view !== "marketplace" || !api) return;
    let live = true;
    void api.myPurchases().then(
      (p) => live && setPurchases(p),
      () => {},
    );
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
  /** Back from Stripe: the account's own return, taken once, and what it has to say. */
  const plan = usePlan();
  const profileReturn = useProfileReturn({ account, api, plan, openProfile });
  const shownNotice = notice ?? profileReturn.message;

  /** A sealed copy waiting on its license key. */
  const [sealed, setSealed] = useState<{ data: Uint8Array; header: ContainerHeader } | null>(null);

  /**
   * A pack's paper asked for by address.
   *
   * The pack has to be in hand before there is anything to render, and
   * that is not true the moment the address is read: a library pack
   * arrives when storage answers, and a marketplace pack has to be
   * fetched. So the want is held and spent once, whenever it can be.
   */
  const drawer = useDocDrawer();
  useEffect(() => {
    if (!wantedDocs) return;
    let live = true;
    void (async () => {
      const { at, kind } = wantedDocs;
      if (at.section === "packs") {
        const mine = imported.find((p) => p.id === at.id);
        // Storage has not answered yet; the next list is another chance.
        if (!mine) return;
        const parsed = loadPackText(mine.source, mine.format ?? "yaml");
        if (live && parsed.ok) drawer.open(parsed.pack, kind, at);
      } else {
        const entry = await marketplaceEntry(at.id);
        const parsed = entry ? loadPackText(await entry.load(), "yaml") : null;
        if (live && parsed?.ok) drawer.open(parsed.pack, kind, at);
      }
      if (live) setWantedDocs(null);
    })();
    return () => {
      live = false;
    };
  }, [wantedDocs, imported, drawer]);

  const result = useMemo(() => loadPackText(source ?? "", "yaml"), [source]);

  /**
   * The pack exactly as written, before the schema fills in defaults.
   *
   * A signature covers what the author signed, and they signed their file:
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
   * Add a marketplace pack to the library. Its text is public, so it syncs to
   * the account without the per-pack switch; on a second device it is
   * simply there.
   */
  const addFromMarketplace = useCallback(async (id: string): Promise<StoredPack | null> => {
    const entry = await marketplaceEntry(id);
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
      // `origin` and `marketplace` are the shape already written on every pack
      // in every library: stored values, not words on a screen, so they
      // keep their spelling while the place they name is the marketplace.
      origin: entry.source === "listing" ? "listing" : "marketplace",
      marketplace: { id: entry.id, version: entry.version },
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
        // A marketplace pack this device lacks is simply fetched: the run is
        // the player's, and the pack is free.
        const added = await addFromMarketplace(saved.packId);
        if (added) mine = added;
      }
      const src = mine?.source;
      if (!src) {
        // A player with no copy of the pack has a seat instead: the
        // watcher's page, with a strip, on the owner's copy. A watcher and
        // an owner are told what they were told before, because neither is
        // seated.
        if (saved.role === "player") {
          goTo(`#seat/${runId}`, "push");
          return true;
        }
        if (!quiet)
          setNotice(
            `Your latest run is on a pack that is not on this device (${saved.packTitle ?? saved.packId}). Load it from a file and it will open.`,
          );
        return false;
      }
      setActiveRunFor(saved.packId, runId);
      setLastActive({ packId: saved.packId, runId });
      choose(saved.packId, src);
      setView("play");
      setNotice(null);
      // A run has an address, so a reload comes back to it and a link says which it is.
      goTo(`#run/${runId}`);
      return true;
    },
    [imported, choose, addFromMarketplace],
  );

  // A dock opens its run the way the app would, and says so while it
  // cannot: the run may not be on this device yet, or the packs may not
  // have loaded. `openRun` is remade as the packs load, so a run that was
  // not here a moment ago is tried again without anyone asking.
  const [dockStatus, setDockStatus] = useState<"opening" | "missing" | "open">("opening");
  const dockOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!dock) {
      dockOpened.current = null;
      return;
    }
    if (dockOpened.current === dock.runId) return;
    let live = true;
    void openRun(dock.runId, true).then((opened) => {
      if (!live) return;
      if (opened) dockOpened.current = dock.runId;
      setDockStatus(opened ? "open" : "missing");
    });
    return () => {
      live = false;
    };
  }, [dock, openRun]);

  /**
   * Continue where you left off: the run this device touched last, or, when
   * it has none, the one the account touched last on any device.
   */
  const continueLast = useCallback(
    async (quiet = false, runId?: string) => {
      const say = (text: string) => !quiet && setNotice(text);
      // Asked for one run in particular (the account's, from the home
      // strip), that one; otherwise whatever was last active on this device,
      // and only failing that the account's last-touched run.
      if (runId) {
        if (await openRun(runId, quiet)) return;
        sync.syncNow();
        say("Fetching that run. Try again in a moment.");
        return;
      }
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

  // A run named in the address opens the way the account's last would:
  // from this device if it is here, else fetched and tried again. Once per
  // address, and quietly, since nobody pressed anything.
  useEffect(() => {
    if (!wantedRun) return;
    const id = wantedRun;
    setWantedRun(null);
    void continueLast(true, id);
  }, [wantedRun, continueLast]);

  /**
   * A device with nothing open, signed in, after its first pass: open what
   * the account was on. Once, not on every pass, so browsing is left alone.
   */
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || account.status !== "signed-in" || sync.status !== "synced") return;
    // An address that names a page, the guide, the profile, the marketplace, a
    // link, is what the person asked for; a reload must land there, not on
    // whatever run the account touched last.
    if (lastActive() || wantedRun || (addressOf(location) && addressOf(location) !== "#")) {
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
   * Which of the packs here the marketplace has moved past. Read whenever the
   * library or the marketplace is on screen, since both offer the update: the
   * shelf on a pack's row, and the card for a pack you already have. A pack
   * the player loaded from a file is never offered anything.
   */
  const [updates, setUpdates] = useState<Map<string, MarketplaceEntry>>(() => new Map());
  /**
   * Ids of the test bench packs, so a copy of one already on the shelf can
   * be marked in the library even where this copy's marketplace does not offer
   * it (production, or a device that added it while testing was on).
   * Unfiltered on purpose: whether a pack you already have is a bench pack
   * does not depend on whether this copy is still handing them out.
   */
  const [benchIds, setBenchIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    // The marketplace asks too: a card for a pack you already have says
    // whether the version listed has moved past yours.
    if (view !== "library" && view !== "marketplace") return;
    let live = true;
    void loadMarketplace({ testing: marketplaceTesting }).then((entries) => live && setUpdates(updatesFor(imported, entries)));
    void loadMarketplace().then((all) => live && setBenchIds(new Set(all.filter((e) => e.bench).map((e) => e.id))));
    return () => {
      live = false;
    };
  }, [view, imported, marketplaceTesting]);

  /**
   * Take the marketplace's newer version: the text and the version change, the
   * record's identity and its switches do not. Runs are untouched: every
   * event is stamped with the pack version it was played under, and the
   * reducer reads whatever pack is loaded now.
   */
  const updateFromMarketplace = useCallback(
    async (record: StoredPack) => {
      const entry = updates.get(record.id) ?? (record.marketplace ? await marketplaceEntry(record.marketplace.id) : null);
      if (!entry) return;
      const at = new Date().toISOString();
      let next: StoredPack;
      if (record.sealed) {
        // A sealed copy is fetched through its purchase: the marketplace's file
        // is not for a buyer, and the server seals the current master
        // under the same key on the way.
        if (!api) return;
        const packId = record.marketplace?.id ?? record.id;
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
        next = {
          ...record,
          title: got.pack.title,
          version: got.pack.version,
          source: got.text,
          format: "yaml",
          updatedAt: at,
          marketplace: { id: packId, version: got.pack.version },
        };
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
          origin: "marketplace",
          marketplace: { id: entry.id, version: entry.version },
        };
      }
      await savePack(next);
      syncBus.localChange("pack", next.id);
      setImported((prev) => prev.map((p) => (p.id === next.id ? next : p)));
      if (activeId === next.id) setSource(next.source);
    },
    [updates, activeId, api, purchases],
  );

  /** What the library lists: every pack in storage, whatever it came from. */
  const libraryPacks = useMemo<LibraryPack[]>(
    () =>
      imported.map((p) => ({
        id: p.id,
        title: p.title,
        sub: `${p.sealed ? "your sealed copy" : p.origin === "marketplace" || p.origin === "listing" ? "from the marketplace" : "from your file"}, v${p.version}`,
        source: p.source,
        record: p,
        ...(updates.has(p.id) ? { update: updates.get(p.id)!.version } : {}),
        ...(benchIds.has(p.id) ? { bench: true } : {}),
      })),
    [imported, updates, benchIds],
  );

  /**
   * A pack named in the address, opened ready to start: `#play/<id>`.
   *
   * The address a Stream Deck key set to one pack opens, so "A new run" on
   * an Elden Ring profile starts an Elden Ring run. It used to open
   * `/create`, which is a path where this app reads hashes and is the
   * Designer rather than a run, so the key opened the pack editor.
   *
   * Once, and only once the library is there to look in: the pack has to be
   * one this account holds. A pack it does not hold leaves the address
   * alone, and the shelf says what there is.
   */
  const openedPack = useRef(false);
  useEffect(() => {
    if (openedPack.current || libraryPacks.length === 0) return;
    const wanted = packToPlayFromHash(addressOf(location));
    if (!wanted) return;
    openedPack.current = true;
    const found = libraryPacks.find((p) => p.id === wanted);
    if (!found) return;
    choose(found.id, found.source);
    setView("play");
  }, [libraryPacks, choose]);

  /** Whether the library is what is on screen right now, whichever way it got there. */
  const onLibrary =
    view === "library" || (source === null && view !== "design" && view !== "profile" && view !== "guide" && view !== "themes");
  /**
   * Whether there is a run to go back to.
   *
   * A pack is loaded, and something other than the run is in front of it.
   * That is the same reading of "a run to go back to" the shelf, the
   * Designer and the Guide each had of their own; said once, it can be a
   * control of its own instead of three buttons that rename themselves.
   */
  /** The welcome page, where there is one to link to. */
  const home = welcomePath(window.location.protocol, import.meta.env.BASE_URL);
  const awayFromRun = source !== null && view !== "play";
  /** Whether Create and Guide belong in the menu at the end rather than in the row. */
  const narrowBar = useNarrowBar();

  /**
   * A sealed copy, opened: keep it, and keep the key that opened it.
   *
   * The pack goes on the shelf like any other, marked sealed so its text
   * never travels. The key is filed under the pack's id, which is the first
   * moment the id is known: the clear header names the sale, not the pack.
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

  /**
   * Keep a pack that came from a file. Where the shelf already has a pack
   * of that id it is the same record with the new text in it, and the
   * account is told: left untold, the vault's older text would come back
   * over the file on the next sync, which is what made replacing a pack
   * look impossible without forgetting it first. Runs are untouched.
   */
  const keepFromFile = useCallback(async (pack: Pack, text: string, filename: string, existing: StoredPack | null): Promise<StoredPack> => {
    const record = keptFromFile(existing, pack, text, filename, new Date().toISOString());
    await savePack(record);
    if (record.sync) syncBus.localChange("pack", record.id);
    setImported((prev) => [...prev.filter((p) => p.id !== record.id), record].sort((a, b) => a.title.localeCompare(b.title)));
    if (existing && !existing.deletedAt) {
      setNotice(replacedNotice(existing, record, pack.vocabulary.run.many.toLowerCase()));
      setSource((current) => (current === existing.source ? text : current));
    }
    return record;
  }, []);

  const onFile = useCallback(
    async (file: File | undefined) => {
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
      const parsed = loadPackText(text, formatOf(file.name));
      setSource(text);

      // Only a pack that actually loads is worth keeping; storing a broken one
      // would put it in the picker forever with no way to tell why it fails.
      if (!parsed.ok) {
        setActiveId("upload");
        return;
      }
      const record = await keepFromFile(parsed.pack, text, file.name, await loadPack(parsed.pack.id));
      setActiveId(record.id);
      rememberPack(record.id);
    },
    [keepOpened, keepFromFile],
  );

  /**
   * A newer file of a pack already on the shelf, chosen on its own row.
   * The row says which pack it is for, so a file of some other pack is
   * refused rather than kept beside it; a sealed copy is not a
   * replacement for anything, it is opened on its own.
   */
  const replaceFromFile = useCallback(
    async (record: StoredPack, file: File | undefined) => {
      if (!file) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (readHeader(bytes)) {
        setNotice("That is a sealed copy. Open it with Load a pack from a file; it does not replace a pack.");
        return;
      }
      const text = await file.text();
      const parsed = loadPackText(text, formatOf(file.name));
      if (!parsed.ok) {
        const first = parsed.diagnostics.find((d) => d.level === "error");
        setNotice(`${file.name} does not load${first ? ` (${first.message})` : ""}, so ${record.title} is as it was.`);
        return;
      }
      const why = notThisPack(record, parsed.pack);
      if (why) {
        setNotice(why);
        return;
      }
      await keepFromFile(parsed.pack, text, file.name, record);
    },
    [keepFromFile],
  );

  /**
   * A bought copy, fetched and opened. By the receipt's token it needs no
   * account and the key is typed from the mail (or is already here); as
   * the signed-in buyer the key comes with the purchase and the copy
   * opens by itself. Either way it is kept marked as a listing, so the
   * marketplace can offer the newer version when there is one.
   */
  useEffect(() => {
    const incoming = bought.purchase;
    if (!incoming) return;
    let live = true;
    const base = apiBase();
    const arrive = async (bytes: Uint8Array, key: string | null, packId?: string, version?: string) => {
      const header = readHeader(bytes);
      if (!header) throw new Error("that is not a sealed pack");
      purchaseExtra.current = { origin: "listing", ...(packId ? { marketplace: { id: packId, version: version ?? "" } } : {}) };
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
            setPurchaseState({
              kind: "error",
              message: "That purchase is not this account's. Sign in as the account that bought it, or use the link in the receipt.",
            });
            return;
          }
          if (purchase.status === "revoked") {
            setPurchaseState({ kind: "error", message: "This copy was revoked by its publisher." });
            return;
          }
          if (purchase.status === "fulfilled" && purchase.key) {
            setPurchaseState({ kind: "opening" });
            const pack = await marketplaceEntry(purchase.packId);
            await arrive(await api.purchaseFile(incoming.ref), purchase.key, purchase.packId, pack?.version);
            return;
          }
          await new Promise((r) => setTimeout(r, 3000));
        }
        if (live)
          setPurchaseState({
            kind: "error",
            message:
              "The copy is taking longer than usual. The receipt mail has a link that fetches it, and it is on your profile under Purchases.",
          });
      } catch (error) {
        if (live)
          setPurchaseState({
            kind: "error",
            message: error instanceof Error && error.message ? error.message : "The copy could not be fetched.",
          });
      }
    };
    void run();
    return () => {
      live = false;
    };
    // The purchase is what matters; the rest are stable for its life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bought.purchase, api]);

  const forget = useCallback(
    async (record: StoredPack) => {
      forgetOpened(record.id);
      // A sealed copy was never told to the server, so there is nobody to
      // tell about its deletion: it goes at once, no tombstone. The license
      // key stays, it is the receipt, and the file can be opened again.
      if (record.sealed) await purgePack(record.id);
      else await forgetPack(record.id);
      await forgetRunsFor(record.id);

      /*
       * And out of any server that was playing it.
       *
       * A vault holds the pack's text so the bot can play it while nobody
       * is present, which is right and is also why it outlives the shelf
       * unless something says otherwise. Taking a pack off your shelf is
       * that something: a server should only be able to play what you
       * currently have.
       *
       * Driven by the press rather than by comparing two lists. A shelf
       * that is empty because this device is new, or because sync has not
       * finished, is not a shelf somebody emptied, and reconciling against
       * one would quietly clear every vault the account has.
       *
       * Best effort, and quiet when it fails. The pack is already off the
       * shelf by this point; a server that could not be reached is a Remove
       * still waiting on the Servers page, not a reason to refuse the
       * removal that was asked for.
       */
      if (api) {
        void (async () => {
          try {
            const { guilds } = await api.myGuilds();
            for (const guild of guilds) {
              try {
                await api.undelegatePack(guild.guildId, record.id);
              } catch {
                // That server keeps it; the Servers page still offers Remove.
              }
            }
          } catch {
            // No answer about servers at all: nothing to do here.
          }
        })();
      }
      setImported((prev) => prev.filter((p) => p.id !== record.id));
      setActiveId((current) => {
        if (current !== record.id) return current;
        setSource(null);
        rememberPack("");
        return "";
      });
    },
    [api],
  );

  // A hosted copy counts the screen, once per change; see hosted/beacon.ts
  // for what is and is not sent. `hosted` itself is read further up, so
  // every `loadMarketplace` call can see it too.
  useEffect(() => {
    countView(dock ? "dock" : widget ? "widget" : liveRoute ? "live" : view, { hosted: hosted !== null, version: __RUNLOG_VERSION__ });
  }, [hosted, dock, widget, liveRoute, view]);

  if (widget) return <WidgetView route={widget} />;
  if (dock) {
    if (dockStatus === "open" && result.ok) return <RunView key={`dock:${result.pack.id}`} pack={result.pack} remote />;
    return <DockWaiting status={dockStatus} />;
  }
  if (seatRoute) {
    return (
      <>
        <SeatRunView id={seatRoute} players={seatPlayers} />
        <Footer onGuide={() => location.assign(linkTo("#guide/seat"))} />
      </>
    );
  }
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
        <Footer onGuide={() => location.assign(linkTo("#guide/streaming", "./"))} />
      </>
    );
  }

  return (
    <div className="app" onClickCapture={onShellClickCapture}>
      <header className="topbar">
        {/* The mark goes home: to the page that says what Runlog is, on
            every width. A plain link, so a middle click and a new tab do
            what they do anywhere; from a file there is no welcome page
            to reach, and the mark opens the shelf instead. It is not a
            heading: every page under it has a title of its own. */}
        <a
          className="brand"
          href={home ?? linkTo("#packs")}
          title={home ? "What Runlog is" : "Your packs and runs"}
          onClick={
            home
              ? undefined
              : (e) => {
                  e.preventDefault();
                  openLibrary();
                }
          }
        >
          <img className="logo" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
          <span className="brandName">Runlog</span>
        </a>
        <div className="topbarEnd">
          {/*
            The way back to the run, and nothing else.

            Packs, Create and Guide used to rename themselves to Play once
            you were standing in them, so the button that took you
            somewhere was the button that brought you back and the
            destination lost its name. The return is its own control now.
            It is here only where there is a run to return to and the run
            is not already on screen, so on the run page there is no
            button rather than a dead one.
          */}
          {awayFromRun && (
            <Button variant="primary" className="backToRun" onClick={returnToRun} aria-label="Back to the run" title="Back to the run">
              <span className="backToRunLong">Back to the run</span>
              {/* The same button on a phone, where the row is measured in
                  single characters. The name it is read by is the whole
                  sentence either way, and the short word is the start of
                  it, so what is seen and what is heard still agree. */}
              <span className="backToRunShort">Back</span>
            </Button>
          )}
          {/*
            One door to the library, in the row with the rest rather than
            adrift beside the logo. It carried the open pack's name until
            the run's own header, a line below, said the same thing twice
            and pushed the row into two at middling widths.

            The three doors are quiet whichever one you are standing in.
            Being on a page is a state, not an action, and the sheet draws
            it from `aria-current` alone: the accent and the rule under
            the word, and no fill. The fill is the way back's, so a bar
            with a run open holds one filled button and it is the one
            that does something.
          */}
          <Button className="packNow" onClick={openLibrary} title="Your packs and runs" aria-current={onLibrary ? "page" : undefined}>
            Packs
          </Button>
          {/*
            Create and Guide, where the row is wide enough to hold them.
            On a phone they are lines in the menu at the end instead, so
            the bar stays one row and each door is in the page once.
          */}
          {!narrowBar && (
            <>
              <Button
                className="createBtn"
                onClick={() => openDesigner()}
                title="Write a pack of your own in the Designer"
                aria-current={view === "design" ? "page" : undefined}
              >
                Create
              </Button>
              <Button
                className="guideBtn"
                onClick={() => openGuide()}
                title="How to use Runlog"
                aria-current={view === "guide" ? "page" : undefined}
              >
                Guide
              </Button>
            </>
          )}
          <AccountBadge
            closeKey={view}
            onOpenThemes={openThemes}
            onOpenProfile={(page) => openProfile(page)}
            {...(narrowBar
              ? {
                  sections: [
                    { label: "Create", hint: "write a pack of your own", current: view === "design", act: () => openDesigner() },
                    { label: "Guide", hint: "how to use Runlog", current: view === "guide", act: () => openGuide() },
                  ],
                }
              : {})}
          />
        </div>
      </header>

      {shownNotice && (
        <div className="notice underBar" role="status">
          <span>{shownNotice}</span>
          <button
            className="ghost tiny"
            onClick={() => {
              setNotice(null);
              profileReturn.dismiss();
            }}
          >
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
      {bought.canceled && (
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

      {result.ok && document !== null && <SignatureBadge document={document} packId={result.pack.id} />}

      {/* Design writes a pack of its own, so whether the *selected* pack
          loads has nothing to do with whether the editor can open. */}
      {sealed ? (
        <SealedPackPrompt
          data={sealed.data}
          header={sealed.header}
          onCancel={() => setSealed(null)}
          onOpened={(doc, key) => void keepOpened(doc, key, sealed.header)}
        />
      ) : view === "marketplace" ? (
        <MarketplaceView
          focus={marketplaceFocus}
          onPack={openMarketplacePack}
          mine={new Set(imported.map((p) => p.id))}
          bought={new Set(purchases.filter((p) => p.status === "fulfilled").map((p) => p.packId))}
          // What the library already worked out, by the marketplace id the
          // card is drawn from rather than the record's own id.
          updatable={new Set([...updates.values()].map((e) => e.id))}
          onUpdate={async (entry) => {
            const found = [...updates.entries()].find(([, e]) => e.id === entry.id);
            const record = found ? imported.find((p) => p.id === found[0]) : null;
            if (record) await updateFromMarketplace(record);
          }}
          {...(api
            ? {
                onBuy: async (entry: MarketplaceEntry) => {
                  const out = await api.startPurchase(entry.id);
                  if ("url" in out) location.href = out.url;
                  else if ("owned" in out && out.owned) setNotice("You already own this pack; it is on your profile under Purchases.");
                  else setNotice("available" in out ? "Buying is not switched on here yet." : "That pack is not for sale just now.");
                },
                onFetch: async (entry: MarketplaceEntry) => {
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
                      setImported((prev) =>
                        [...prev.filter((p) => p.id !== record.id), record].sort((a, b) => a.title.localeCompare(b.title)),
                      );
                      choose(record.id, record.source);
                    }
                  } catch (error) {
                    setNotice(error instanceof Error && error.message ? error.message : "The copy could not be fetched.");
                  }
                },
              }
            : {})}
          onAdd={async (entry) => {
            if (!(await addFromMarketplace(entry.id))) throw new Error("The pack could not be added.");
          }}
          onOpen={(id) => {
            const p = imported.find((q) => q.id === id);
            if (p) {
              choose(p.id, p.source);
              setView("play");
            }
          }}
          onBack={openLibrary}
        />
      ) : bench && (view === "design" || onLibrary) ? (
        <RunView
          key={`bench:${bench.pack.id}`}
          pack={bench.pack}
          store={bench.store}
          bench={{ from: bench.from, onLeave: () => setBench(null) }}
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
            // This one knows which run, so it says which run: the rule
            // above would settle for `play`, which is a reload away
            // from the same place but not a link worth sending.
            goTo(`#run/${r.runId}`);
          }}
          onContinueLast={(runId) => void continueLast(false, runId)}
          seats={runRecords.filter((r) => r.role === "player" && !imported.some((p) => p.id === r.packId))}
          onTakeSeat={(r) => goTo(`#seat/${r.runId}`, "push")}
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
          onTest={(p) => {
            const parsed = loadPackText(p.source, p.record?.format ?? "yaml");
            if (parsed.ok) openBench(parsed.pack, "the library");
            else setNotice(`${p.title} does not load, so it cannot be tested.`);
          }}
          onFile={(file) => {
            setView("play");
            void onFile(file);
          }}
          onSyncToggle={(record, on) => {
            setImported((prev) => prev.map((q) => (q.id === record.id ? { ...q, sync: on } : q)));
            void sync.setPackSync(record.id, on);
          }}
          onMarketplace={openMarketplace}
          onOpenSettings={() => openProfile("settings")}
          onUpdate={(record) => void updateFromMarketplace(record)}
          onReplace={(record, file) => void replaceFromFile(record, file)}
          {...(api
            ? {
                onJoinRace: async (code: string) => {
                  try {
                    const race = await api.joinRace(code);
                    rememberRaceCode(code);
                    const here = imported.find((p) => p.id === race.meta.packId);
                    if (!here) {
                      setNotice(
                        `That race plays ${race.meta.packTitle ?? race.meta.packId}, which is not on your shelf. Add it from the marketplace; the code is kept.`,
                      );
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
      ) : view === "themes" ? (
        <ThemeStudio onBack={leaveThemes} registerLeaveGuard={registerThemeLeaveGuard} />
      ) : view === "guide" ? (
        <GuideView slug={guideSlug} section={guideSection} onNavigate={(slug, section) => openGuide(slug, section)} onBack={leaveGuide} />
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
        <DesignView onTest={(pack) => openBench(pack, "the Designer")} />
      ) : !result.ok ? (
        <Diagnostics diagnostics={result.diagnostics} />
      ) : (
        <RunView key={result.pack.id} pack={result.pack} />
      )}
      <Footer onGuide={() => openGuide()} />
      <TermsGate />
      <NameGate />
    </div>
  );
}

/** The dock before its run has arrived: not open yet, or not on this device. */
function DockWaiting({ status }: { status: "opening" | "missing" | "open" }) {
  useTitle("Dock");
  return (
    <main className="main remote">
      <div className="pipPanel">
        <p className="muted">
          {status === "missing"
            ? "This run is not on this device. Open it in the app here first, and the dock follows."
            : "Opening the run…"}
        </p>
      </div>
    </main>
  );
}

function Diagnostics({ diagnostics }: { diagnostics: Diagnostic[] }) {
  useTitle(null);
  return (
    <main className="diagnostics">
      <h2>This pack did not load</h2>
      <p className="muted">The same three gates the engine uses: version, then shape, then coherence.</p>
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
 * The built-ins moved under the operator's domain. A pack stored under an
 * old id becomes the marketplace's current copy under the new one, its runs
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
    const entry = await marketplaceEntry(next);
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
      origin: "marketplace",
      marketplace: { id: next, version: entry.version },
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
    // The header shelf's short names for the built-ins, from before the marketplace.
    return id ? (LEGACY_IDS[id] ?? id) : null;
  } catch {
    return null;
  }
}

/**
 * The library on first load: what should be there that is not.
 *
 * A device that played a built-in before the marketplace has runs for a pack
 * it no longer has in the bundle; each such pack is added from the
 * marketplace so the runs have their pack. A device with nothing at all gets
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
    const entry = await marketplaceEntry(id);
    if (!entry) continue;
    const text = await entry.load();
    const parsed = loadPackText(text, "yaml");
    if (!parsed.ok) continue;
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
      origin: "marketplace",
      marketplace: { id: entry.id, version: entry.version },
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
