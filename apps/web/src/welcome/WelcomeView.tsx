import { hrefFor, linkTo, PATHS_ON } from "../route.ts";
import { useCallback, useEffect, useState } from "react";
import { countView } from "../hosted/beacon.ts";
import { useHosted } from "../hosted/HostedProvider.tsx";
import { Footer } from "../hosted/Footer.tsx";
import { loadMarketplace, shippedIds, type MarketplaceEntry } from "../library/marketplace.ts";
import { PersonaChips } from "./PersonaChips.tsx";
import { savePersona, savedPersona, type Persona } from "./personas.ts";
import { appPath, baseOf, setSkipWelcome, skipWelcome } from "./route.ts";
import { useTitle } from "../title.ts";

/**
 * The welcome page: what Runlog is, in one line, at the bare address.
 *
 * Part of the app rather than of any hosted wrapper, so every copy has
 * it: the hosted one, the public one, one served from the command line.
 * It says the same thing everywhere and points at the app under `play`.
 * A person who has read it once can choose to skip it from then on.
 *
 * The headline is the definition and never changes. What changes is the
 * log beside it, which is one person's run: the chips under it say whose,
 * and the excerpt further down follows the same choice (see personas.ts).
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
  const choose = useCallback(
    (next: Persona) => {
      setPersona(next);
      savePersona(storage, next);
    },
    [storage],
  );
  // The end of the log, which is where the line marked `heat` falls: the
  // result that reaches back, which is what the section is about. Starting
  // at the top would only repeat the specimen in the hero above it.
  const excerpt = persona.log.slice(-3);

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
          <a className="ghost" href="https://github.com/SCRT-HQ/runlog">
            Source
          </a>
          {hosted?.links.pricing && (
            <a className="ghost" href={hosted.links.pricing}>
              Pricing
            </a>
          )}
          {/* The same word the app's own bar uses for the same place. */}
          <a className="ghost" href={linkTo("#guide/start", play)}>
            Guide
          </a>
          <a className="primary" href={play}>
            Play
          </a>
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
              <a className="primary" href={play}>
                Play
              </a>
              <a className="ghost" href={linkTo("#marketplace", play)}>
                See the packs
              </a>
            </p>
            <p className="muted small">Free. No account. Open source under MIT.</p>
          </div>

          <div className="welcomeShow">
            <figure className="specimen" aria-label="A run log, as Runlog writes it" key={persona.id}>
              <figcaption className="muted small">
                <a href={linkTo(`#marketplace/${persona.packId}`, play)}>{persona.packTitle}</a> · {persona.mode} · {persona.at}
              </figcaption>
              <ol className="specimenLog">
                {persona.log.map((line, i) => (
                  <li key={i} className={line.heat ? "heat" : undefined}>
                    <span className="where">{line.where}</span>
                    <span className="roll">{line.roll}</span>
                    <p>{line.text}</p>
                  </li>
                ))}
              </ol>
              <div className="specimenState">
                {persona.state.map((entry) => (
                  <span key={entry.label}>
                    <b>{entry.label}</b> {entry.value}
                  </span>
                ))}
                <span className="clock">{persona.clock}</span>
              </div>
            </figure>
            <PersonaChips persona={persona} onChange={choose} />
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
              A drawing of the widget, not a photograph of one: the guide has
              no screenshot of a scoreboard over a game, and a made-up one
              would be a promise the app had not kept. These are the widget's
              own styles with placeholder rows in them, and the caption says
              so. The rows are hidden from assistive tech, which would
              otherwise read out invented names and scores as if they were a
              run; the figure's label and the caption say what it is instead.
            */}
            <figure className="welcomeWidget" aria-label="The scoreboard and twist widgets, as a drawing">
              <div className="widgetBody" aria-hidden="true">
                <div className="widgetTitle muted small">Scoreboard · 3 racing</div>
                <ol className="widgetBoard">
                  <li className="me">
                    <span className="place">#1</span>
                    <span className="who">Vex</span>
                    <span className="num">7</span>
                  </li>
                  <li>
                    <span className="place">#2</span>
                    <span className="who">Marrow</span>
                    <span className="num">5</span>
                  </li>
                  <li>
                    <span className="place">#3</span>
                    <span className="who">Quill</span>
                    <span className="num">2</span>
                  </li>
                </ol>
              </div>
              <div className="widgetBody" aria-hidden="true">
                <ul className="widgetTicker">
                  <li className="rolled">
                    <span className="tickMark">d12 → 5</span>
                    <span className="tickText">Inverted controls, until the round is called.</span>
                  </li>
                </ul>
              </div>
              <figcaption className="muted small">The scoreboard and twist widgets, drawn from the app's own styles.</figcaption>
            </figure>
          </div>
        </section>

        <section className="welcomeSection">
          <h3 className="sectionTitle">It remembers</h3>
          <div className="welcomeSplit">
            <p>
              A result that reaches back an hour. A counter that keeps running under everything. "After you finish, roll a d6." Runlog
              applies it and writes it down, so the log is something you can export, print, or race a friend on with the same seed.
            </p>
            <figure className="specimen welcomeExcerpt" key={persona.id} aria-label="Three lines from the log">
              <ol className="specimenLog">
                {excerpt.map((line, i) => (
                  <li key={i} className={line.heat ? "heat" : undefined}>
                    <span className="where">{line.where}</span>
                    <span className="roll">{line.roll}</span>
                    <p>{line.text}</p>
                  </li>
                ))}
              </ol>
            </figure>
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
            <a className="primary" href={play}>
              Play
            </a>
            <a className="ghost" href={linkTo("#guide/start", play)}>
              Read the guide
            </a>
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
