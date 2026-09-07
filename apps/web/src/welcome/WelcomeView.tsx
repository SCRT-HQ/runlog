import { useEffect, useState } from "react";
import { useHosted } from "../hosted/HostedProvider.tsx";
import { Footer } from "../hosted/Footer.tsx";
import { appPath, baseOf, setSkipWelcome, skipWelcome } from "./route.ts";

/**
 * The welcome page: what Runlog is, and why, at the bare address.
 *
 * Part of the app rather than of any hosted wrapper, so every copy has
 * it: the hosted one, the public one, one served from the command line.
 * It says the same thing everywhere and points at the app under `play`.
 * What differs by copy is only the pricing, which a hosted copy names
 * and the rest leave out, and the footer, which only a hosted copy has.
 * A person who has read it once can choose to skip it from then on.
 */
export function WelcomeView() {
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

  // A hash typed or pasted onto this page (a live link, a guide page) is a
  // same-document change the browser does not reload for: go to the app.
  useEffect(() => {
    const onHash = () => {
      if (location.hash) location.replace(`${play}${location.search}${location.hash}`);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [play]);

  return (
    <div className="welcome">
      <header className="topbar welcomeBar">
        <a className="brand" href={play} title="Open Runlog">
          <img className="logo" src="./icon.svg" alt="" />
          <h1>Runlog</h1>
        </a>
        <span />
        <nav className="topbarEnd" aria-label="Ways in">
          <a className="ghost" href={`${play}#guide/start`}>
            Docs
          </a>
          {hosted?.links.pricing && (
            <a className="ghost" href={hosted.links.pricing}>
              Pricing
            </a>
          )}
          <a className="ghost" href="https://github.com/SCRT-HQ/runlog">
            Source
          </a>
          <a className="primary" href={play}>
            Open Runlog
          </a>
        </nav>
      </header>

      <main className="welcomeMain">
        <section className="welcomeHero">
          <div className="welcomeWords">
            <h2>A referee and a run log for games played around the things you already do.</h2>
            <p className="welcomeLede">
              A day at the wheel, a kitchen under constraint, an hour of practice, a house cleaned like a dungeon. Runlog reads a{" "}
              <em>pack</em>, a small file of tables, states and steps, and becomes that game: it rolls, remembers, reaches back, and
              writes the log, so your hands stay on the work.
            </p>
            <p className="welcomeCtas">
              <a className="primary" href={play}>
                Open Runlog
              </a>
              <a className="ghost" href={`${play}#guide/start`}>
                Read the guide
              </a>
              <a className="ghost" href={`${play}#catalog`}>
                See the packs
              </a>
            </p>
            <p className="muted small">Free, no account needed, works offline. Open source under MIT.</p>
          </div>

          <figure className="specimen" aria-label="A run log, as Runlog writes it">
            <figcaption className="muted small">The Long Kiln · Standard Firing · Stage 4</figcaption>
            <ol className="specimenLog">
              <li>
                <span className="where">Stage 2, Kiln Check</span>
                <span className="roll">d100 → 26</span>
                <p>The Kiln dictates the form. Roll on the Form table.</p>
              </li>
              <li>
                <span className="where">Stage 2, Form</span>
                <span className="roll">d6 → 4</span>
                <p>A cup. Small, and it must be usable.</p>
              </li>
              <li>
                <span className="where">Stage 2, Constraint</span>
                <span className="roll">d12 → 10</span>
                <p>One glaze only, applied once.</p>
              </li>
              <li className="heat">
                <span className="where">Stage 4, Kiln Check</span>
                <span className="roll">d100 → 88 · hit #2</span>
                <p>Thermal shock reaches back. The cup from Stage 2 cracks; mark it.</p>
              </li>
            </ol>
            <div className="specimenState">
              <span>
                <b>Glaze</b> 3 / 6
              </span>
              <span>
                <b>Calm streak</b> 1
              </span>
              <span>
                <b>Setbacks</b> 1
              </span>
              <span className="clock">Stage 4 · 12:41</span>
            </div>
          </figure>
        </section>

        <section>
          <h3 className="sectionTitle">
            How it goes <span className="muted">three moves</span>
          </h3>
          <ol className="welcomeSteps">
            <li>
              <span className="idx">1</span>
              <div>
                <h4>Pick a pack, or write one</h4>
                <p>
                  Eleven come free: a day of things to do, housework as a dungeon crawl, cooking under constraint, deliberate practice,
                  ceramics, a journaling game, a training log, and challenge packs for games people already play. The Designer writes
                  new ones without touching a file.
                </p>
              </div>
            </li>
            <li>
              <span className="idx">2</span>
              <div>
                <h4>Play the run</h4>
                <p>
                  Each unit of the game, a stage, a day, a room, walks its steps: roll on a table, take what comes, declare what you are
                  making, make it. Runlog keeps the states, counters, timers and deferred results, and applies the consequences that land
                  on earlier work. It never judges the work itself; it cannot see it.
                </p>
              </div>
            </li>
            <li>
              <span className="idx">3</span>
              <div>
                <h4>Keep the log</h4>
                <p>
                  Every roll and its reasoning is written down. Export the run, print the pack's paper, share a live link so people can
                  watch it happen, or race a friend on another device with the same seed.
                </p>
              </div>
            </li>
          </ol>
        </section>

        <section>
          <h3 className="sectionTitle">
            Why Runlog <span className="muted">what it does that paper and spreadsheets do not</span>
          </h3>
          <dl className="welcomeReasons">
            <div>
              <dt>It does not know your game. That is the point.</dt>
              <dd>
                Every noun on screen comes from the pack's own vocabulary: a Firing of Stages, a Crawl of Rooms, a Session of Sets. One
                app, any game of rounds, dice and consequences.
              </dd>
            </div>
            <div>
              <dt>The bookkeeping nobody wants.</dt>
              <dd>
                Results that reach back and damage something you made an hour ago. States that pile up. Counters running in the
                background. "After you finish, roll a d6." All of it remembered, applied and written down.
              </dd>
            </div>
            <div>
              <dt>Yours first.</dt>
              <dd>
                Everything runs in the browser and nothing leaves your device unless you sign in. Sign in and your runs, packs and license
                keys follow you; sign out and they are still on the shelf.
              </dd>
            </div>
            <div>
              <dt>A table with company.</dt>
              <dd>
                Invite people into a run as players or watchers, on their own devices. Moderate a race with a live scoreboard. Share a
                link anyone can watch, put widgets on a stream, throw dice everyone sees land.
              </dd>
            </div>
            <div>
              <dt>Paper included.</dt>
              <dd>
                A rulebook, a quick start, a reference card, a run log sheet and a catalog summary, all written from the pack as it is,
                as PDF, HTML and Markdown. A signed release carries your name.
              </dd>
            </div>
            <div>
              <dt>Sell it your way.</dt>
              <dd>
                Seal a copy for a buyer from your own hands, for free, forever. Or list it in the catalog and let it handle the sale, the
                delivery and the ledger for five percent.
              </dd>
            </div>
            <div>
              <dt>Open, and yours to run.</dt>
              <dd>
                The app, the engine, the format and the command line are MIT. <code>npx @scrthq/runlog serve</code> puts the whole app
                on a local port with nothing else installed.
              </dd>
            </div>
            <div>
              <dt>Dice you can read.</dt>
              <dd>
                Every roll shows its working: the notation, the numbers, the range it fell in. The value is decided before the dice
                move, so a seeded run replays exactly and a watcher sees the same throw.
              </dd>
            </div>
          </dl>
        </section>

        {hosted?.links.pricing ? (
          <section>
            <h3 className="sectionTitle">
              What it costs <span className="muted">the app is free; a server is what costs</span>
            </h3>
            <div className="welcomePlans">
              <div>
                <h4>Free</h4>
                <p>Every pack, every mode, the Designer, the command line, sync between your own devices, moderated play on one device.</p>
              </div>
              <div>
                <h4>
                  Plus <span className="muted small">$4 a month</span>
                </h4>
                <p>People in your runs on their own devices, races across devices, live links and stream widgets.</p>
              </div>
              <div>
                <h4>
                  Publisher <span className="muted small">5% of a sale</span>
                </h4>
                <p>List packs in the catalog, paid through your own Stripe account, with a ledger. Or 0% with hosted licensing.</p>
              </div>
            </div>
            <p className="muted small">
              <a href={hosted.links.pricing}>The whole of it, on the pricing page.</a>{" "}
              {hosted.features.billing ? "Subscribe from your profile in the app." : "Not switched on yet: everything in Plus is free for everyone while Runlog is in preview."}
            </p>
          </section>
        ) : (
          <section>
            <h3 className="sectionTitle">
              What it costs <span className="muted">nothing, here</span>
            </h3>
            <p className="muted">
              This copy is the plain app: no account, no server, no fee. The hosted copy at{" "}
              <a href="https://runlog.scrthq.com/">runlog.scrthq.com</a> adds accounts, sync, tables with company and the catalog.
            </p>
          </section>
        )}

        <section className="welcomeClosing">
          <h3>Roll for the clay.</h3>
          <p className="welcomeCtas">
            <a className="primary" href={play}>
              Open Runlog
            </a>
            <a className="ghost" href={`${play}#guide/design`}>
              Write a pack
            </a>
          </p>
          <label className="toggle welcomeSkip" title="On this device, the address goes straight to the app. The footer's What Runlog is brings this page back.">
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
        <Footer onGuide={() => location.assign(`${play}#guide/start`)} />
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
