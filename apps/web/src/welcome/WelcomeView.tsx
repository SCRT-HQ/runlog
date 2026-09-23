import { hrefFor, linkTo, PATHS_ON } from "../route.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { countView } from "../hosted/beacon.ts";
import { useHosted } from "../hosted/HostedProvider.tsx";
import { Footer } from "../hosted/Footer.tsx";
import { loadMarketplace, shippedIds, type MarketplaceEntry } from "../library/marketplace.ts";
import { PersonaChips } from "./PersonaChips.tsx";
import { loadDemoPack } from "./demoPacks.ts";
import { generateDemoExample, type DemoExample } from "./demoScenario.ts";
import { DemoHistory, DemoSpecimen, DemoWidgets } from "./DemoExample.tsx";
import { savePersona, savedPersona, type Persona } from "./personas.ts";
import { appPath, baseOf, setSkipWelcome, skipWelcome } from "./route.ts";
import { useTitle } from "../title.ts";
import { Button, ButtonLink } from "../ui/Button.tsx";

/**
 * The welcome page: what Runlog is, in one line, at the bare address.
 *
 * Part of the app rather than of any hosted wrapper, so every copy has
 * it: the hosted one, the public one, one served from the command line.
 * It says the same thing everywhere and points at the app under `play`.
 * A person who has read it once can choose to skip it from then on.
 *
 * The headline is the definition and never changes. What changes is the
 * example beside it: one run generated from one of five bundled packs
 * (see demoPacks.ts and demoScenario.ts). The chips under it say whose, and
 * the widgets and the excerpt further down are the same run.
 */
export function WelcomeView() {
  useTitle(null);
  const hosted = useHosted();
  const base = typeof location !== "undefined" ? baseOf(location.href) : "/";
  const play = appPath(base);
  const storage = (() => {
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch {
      return null;
    }
  })();
  const [skip, setSkip] = useState(() => skipWelcome(storage));
  const [persona, setPersona] = useState<Persona>(() => savedPersona(storage));
  // What is asked for is kept apart from what is shown. A request is the
  // persona, a generation, whether it asks for a different run than the one
  // on screen (only "Another example" does), and a retry count, so pressing
  // the chip of an example that failed asks again.
  const [request, setRequest] = useState({ generation: 0, vary: false, retry: 0 });
  const key = `${persona.id}:${request.generation}`;

  // The shown example is one resolved model, and the hero, the widgets and
  // the excerpt all read that one value, so they change together and never
  // mix one run with another's label. A load that finishes after the reader
  // has asked for something else is dropped.
  const [shown, setShown] = useState<{ key: string; example: DemoExample } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const shownRef = useRef<{ key: string; example: DemoExample } | null>(null);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  const choose = useCallback(
    (next: Persona) => {
      if (next.id === persona.id) {
        // The chip already pressed: nothing to change, unless its example failed.
        if (failedKey === key) {
          setFailedKey(null);
          setRequest((r) => ({ ...r, retry: r.retry + 1 }));
        }
        return;
      }
      setPersona(next);
      setRequest({ generation: 0, vary: false, retry: 0 });
      savePersona(storage, next);
    },
    [storage, persona.id, failedKey, key],
  );

  useEffect(() => {
    // Back on the persona whose example is still on screen (the other
    // choice failed or was still loading): that example is the answer.
    if (shownRef.current?.key === key) return;
    let live = true;
    loadDemoPack(persona.id)
      .then((pack) => {
        if (!live) return;
        const { generation, vary } = request;
        // Another example that happens to draw the same run as the one on
        // screen reads as a button that did nothing, so a few more
        // generations are tried. Collisions are common in the smaller
        // packs, so the tries are bounded and a repeat is then accepted.
        // Only a press of that button asks for a different run; choosing a
        // persona shows its own generation as it comes.
        const previous = vary ? shownRef.current?.example : undefined;
        let example = generateDemoExample(persona, pack, { generation, now: DEMO_NOW });
        for (
          let attempt = 1;
          attempt < MAX_ATTEMPTS && previous?.personaId === persona.id && example.signature === previous.signature;
          attempt++
        ) {
          example = generateDemoExample(persona, pack, { generation: generation + attempt, now: DEMO_NOW });
        }
        setShown({ key, example });
        setFailedKey(null);
      })
      .catch((error: unknown) => {
        if (!live) return;
        console.warn(`Landing example unavailable: ${persona.id}, generation ${request.generation}`, error);
        setFailedKey(key);
      });
    return () => {
      live = false;
    };
  }, [persona, request, key]);
  const pending = shown?.key !== key && failedKey !== key;
  const example = shown?.example ?? null;
  const another = () => {
    if (pending) return;
    // On from the generation on screen, which may be past the one asked for.
    const from = example?.personaId === persona.id ? example.generation : request.generation;
    setRequest({ generation: from + 1, vary: true, retry: 0 });
  };
  // "Loading…" only once a load has taken a moment: a pack already loaded
  // answers within a frame, and a word that flashes for one would only
  // shake the bar. The timer shows a word; it never asks for an example.
  const [slowKey, setSlowKey] = useState<string | null>(null);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setSlowKey(key), LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pending, key]);
  const status = pending ? (slowKey === key ? "Loading…" : null) : failedKey === key ? "Example unavailable" : null;

  // The shelf, from the same source the marketplace reads: the packs that
  // ship, in the marketplace's own order. By id rather than by `source`,
  // because the platform seeds the built-ins into the feed and a listing
  // wins over the bundle's copy, so on a hosted copy they come back as
  // listings. Loaded after the first paint, and where the marketplace
  // cannot be read the strip is simply empty.
  const [shelf, setShelf] = useState<MarketplaceEntry[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.all([loadMarketplace({ testing: false }), shippedIds()])
      .then(([all, shipped]) => {
        if (live) setShelf(all.filter((entry) => shipped.has(entry.id)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // A hash typed or pasted onto this page (a live link, a guide page) is a
  // same-document change the browser does not reload for: go to the app.
  useEffect(() => {
    const onHash = () => {
      if (location.hash)
        location.replace(PATHS_ON ? `${hrefFor(location.hash)}${location.search}` : `${play}${location.search}${location.hash}`);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [play]);

  // A hosted copy counts the visit; see hosted/beacon.ts for what is sent.
  useEffect(() => {
    countView("welcome", { hosted: hosted !== null, version: __RUNLOG_VERSION__ });
  }, [hosted]);

  return (
    <div className="welcome">
      <header className="topbar welcomeBar">
        <a className="brand" href={play} title="Play">
          <img className="logo" src="./icon.svg" alt="" />
          <h1>Runlog</h1>
        </a>
        <nav className="topbarEnd" aria-label="Ways in">
          <ButtonLink href="https://github.com/SCRT-HQ/runlog">Source</ButtonLink>
          {hosted?.links.pricing && <ButtonLink href={hosted.links.pricing}>Pricing</ButtonLink>}
          {/* The same word the app's own bar uses for the same place. */}
          <ButtonLink href={linkTo("#guide/start", play)}>Guide</ButtonLink>
          <ButtonLink variant="primary" href={play}>
            Play
          </ButtonLink>
        </nav>
      </header>

      <main className="welcomeMain">
        <section className="welcomeHero">
          <div className="welcomeWords">
            <h2>Runlog is a constraint engine.</h2>
            <p className="welcomeTagline">Runlog controls the rules. You control the outcome.</p>
            <p className="welcomeLede">
              Pick a pack, press Roll, and the dice hand you the next constraint: a curse on the region, a rule for the next transition, a
              limit on the next block of work. Runlog keeps it honest, keeps the score, and writes it all down, on stream or on your own.
            </p>
            <p className="welcomeCtas">
              <ButtonLink variant="primary" href={play}>
                Play
              </ButtonLink>
              <ButtonLink href={linkTo("#marketplace", play)}>See the packs</ButtonLink>
            </p>
            <p className="muted small">Free. No account. Open source under MIT.</p>
          </div>

          <div className="welcomeShow">
            {/*
              The controls above the example, not under it: examples differ
              in length, and a button below one would move out from under
              the pointer between presses.
            */}
            <PersonaChips persona={persona} onChange={choose} />
            <div className="welcomeExampleBar">
              {/*
                Marked, not disabled, while its example loads: a disabled
                button drops the keyboard focus the press just put on it.
              */}
              <Button size="compact" className="welcomeAnother" aria-disabled={pending || undefined} onClick={another}>
                Another example
              </Button>
              {status && <span className="welcomeExampleStatus muted small">{status}</span>}
            </div>
            {example ? (
              <DemoSpecimen example={example} packHref={linkTo(`#marketplace/${example.packId}`, play)} />
            ) : (
              <figure className="specimen welcomeExamplePlaceholder" aria-label="An example run">
                <figcaption className="muted small">Example</figcaption>
              </figure>
            )}
          </div>
        </section>

        <section className="welcomeSection">
          <h3 className="sectionTitle">Three moves</h3>
          <ol className="welcomeSteps">
            <li>
              <span className="idx">1</span>
              <div>
                <h4>Pick a pack.</h4>
                <p>
                  Nine come free: challenge packs for games people already stream, a called mechanic for a DJ set, a day in blocks for
                  focused work. Or write your own; the Designer does it without a file.
                </p>
              </div>
            </li>
            <li>
              <span className="idx">2</span>
              <div>
                <h4>Press Roll.</h4>
                <p>The dice choose the next constraint. Your own dice count too: roll them and type what they said.</p>
              </div>
            </li>
            <li>
              <span className="idx">3</span>
              <div>
                <h4>Play what comes.</h4>
                <p>Runlog applies it, times it, and remembers what reaches back into earlier work. The log writes itself.</p>
              </div>
            </li>
          </ol>
        </section>

        <section className="welcomeSection">
          <h3 className="sectionTitle">On your stream</h3>
          <div className="welcomeSplit">
            <div>
              <p>
                Paste one address into OBS, Streamlabs or StreamElements and the roll lands where chat can see it. Nothing for viewers to
                install. Chat can be the roster, and a race on the same seed puts another channel on the leaderboard beside you.
              </p>
              <p>
                Crowd Control lets chat push the buttons. Runlog decides what the run says happens next, and whether it counted. They work{" "}
                <a href={linkTo("#guide/stream-why", play)}>side by side</a>.
              </p>
            </div>
            {/*
              The widgets as a stream would stack them, drawn with their own
              styles from the same generated run as the log above, and
              captioned with that run's pack, mode and unit.
            */}
            {example && <DemoWidgets example={example} />}
          </div>
        </section>

        <section className="welcomeSection">
          <h3 className="sectionTitle">It remembers</h3>
          <div className="welcomeSplit">
            <p>
              A result that reaches back an hour. A counter that keeps running under everything. "After you finish, roll a d6." Runlog
              applies it and writes it down, so the log is something you can export, print, or race a friend on with the same seed.
            </p>
            {example && <DemoHistory example={example} />}
          </div>
        </section>

        <section className="welcomeSection">
          <h3 className="sectionTitle">Yours</h3>
          <p className="welcomeProse">
            Everything runs in the browser, and nothing leaves your device unless you sign in. Sign in and your runs, packs and license keys
            follow you. The app, the engine and the pack format are MIT; <code>npx @scrthq/runlog serve</code> puts the whole thing on a
            local port.
          </p>
        </section>

        <section>
          <h3 className="sectionTitle">
            The packs <span className="muted">nine free, and a marketplace</span>
          </h3>
          <div className="welcomePacks">
            {shelf.map((entry) => (
              <a className="welcomePack" key={entry.id} href={linkTo(`#marketplace/${entry.id}`, play)}>
                <strong>{entry.title}</strong>
                {entry.description && <span className="muted small">{firstSentence(entry.description)}</span>}
              </a>
            ))}
          </div>
        </section>

        <section className="welcomeClosing">
          <p className="welcomeCtas">
            <ButtonLink variant="primary" href={play}>
              Play
            </ButtonLink>
            <ButtonLink href={linkTo("#guide/start", play)}>Read the guide</ButtonLink>
          </p>
          <label
            className="toggle welcomeSkip"
            title="On this device, the address goes straight to the app. The Runlog mark in the app's bar brings this page back."
          >
            <input
              type="checkbox"
              checked={skip}
              onChange={(e) => {
                setSkipWelcome(storage, e.target.checked);
                setSkip(e.target.checked);
              }}
            />
            <span>Skip this page next time</span>
          </label>
        </section>
      </main>

      {hosted ? (
        <Footer onGuide={() => location.assign(linkTo("#guide/start", play))} />
      ) : (
        <footer className="siteFooter">
          <nav aria-label="About this app">
            <a href="https://github.com/SCRT-HQ/runlog">Source</a>
            <a href="https://github.com/SCRT-HQ/runlog/blob/main/LICENSE">MIT license</a>
          </nav>
        </footer>
      )}
    </div>
  );
}

/** The one moment every example is generated at, so a generation reads the same on every visit. */
export const DEMO_NOW = "2026-09-18T12:00:00.000Z";

/** How many generations "Another example" tries before it accepts a repeat of the run on screen. */
const MAX_ATTEMPTS = 4;

/** How long a load runs before the bar says "Loading…". */
const LOADING_DELAY_MS = 150;

/**
 * The first sentence of a pack's description, the period kept.
 *
 * A card takes one line about the pack, not the pack's whole blurb: the
 * descriptions run from one sentence to four, and printing all of them
 * made the strip taller than every section above it and every card a
 * different height.
 */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const end = trimmed.search(/\.(\s|$)/);
  return end === -1 ? trimmed : trimmed.slice(0, end + 1);
}
