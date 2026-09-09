import { useMemo, useState } from "react";
import type { Pack } from "@runlog/rules-schema";
import {
  describeDifference,
  externalName,
  type Difference,
  type RunState,
} from "@runlog/engine";
import { MockEnvironment } from "./mock.ts";
import { useEnvironment } from "./useEnvironment.ts";

/**
 * The link to whatever the player is actually working in.
 *
 * Reports, never resolves. The app cannot know whether a track was renamed on
 * purpose or a subject was never made, so it shows the disagreement and leaves
 * the ruling to the person: the same stance the rules take on contradictions.
 *
 * Only the mock is wired up so far. A real adapter is a socket away and slots
 * in without this file changing, which is the point of building the port
 * first: the panel has never known which environment it is talking to.
 */

/**
 * A page served over https cannot open a plain-text socket to a program on the
 * machine, so an adapter that bridges to a local application only works when
 * the app is running locally. Better to say it up front than to let someone
 * debug a browser security rule.
 */
const overHttps = typeof location !== "undefined" && location.protocol === "https:";

export function EnvironmentPanel({ pack, state }: { pack: Pack; state: RunState }) {
  const v = pack.vocabulary;

  // Held for the life of the panel so the pretend session survives a re-render.
  const mock = useMemo(() => new MockEnvironment(), []);
  const env = useEnvironment(pack, state, mock);
  const [open, setOpen] = useState(false);

  const connected = env.status === "connected";

  return (
    <section className="panel">
      <h3 className="sectionTitle">
        <button className="disclose" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "▾" : "▸"} Check against your real files
        </button>{" "}
        <span className="muted">
          {connected ? `${env.subjects.length} found` : "nothing connected yet"}
        </span>
      </h3>

      {open && (
        <>
          <p className="muted small">
            The board on the right is what this app <em>believes</em> you have made. The
            work itself lives somewhere else: a folder, a project file, a repository.
            When the two disagree, the game quietly goes wrong: {v.subject.many.toLowerCase()}{" "}
            are targeted <em>by position</em>, so a run whose order does not match yours
            will reach back and hit the wrong one while showing convincing working.
          </p>
          <p className="muted small">
            Connecting somewhere lets this app compare the two and tell you where they
            differ. It only ever reads and reports, it never touches your work, and it
            never decides who is right.
          </p>
          <p className="muted small">
            <strong>There is no real connection yet.</strong> Reading a folder or a
            project file needs a small bridge running on this machine, which does not
            exist so far. What is here is the practice environment below: a made-up set
            of things you can make agree and disagree, so the comparison can be seen
            working before anything real is plugged into it.
          </p>

          {overHttps && (
            <div className="notice">
              This page is served over https, so it cannot reach a bridge running on this
              machine. Run the app locally for that: the built files work opened straight
              from disk.
            </div>
          )}

          <div className="exportRow">
            <button className="ghost" onClick={() => void env.connect()} disabled={env.busy || connected}>
              {env.busy ? "Connecting…" : "Connect"}
            </button>
            <button className="ghost" onClick={env.disconnect} disabled={!connected}>
              Disconnect
            </button>
            <span className="muted small">
              {env.link?.label}, a stand-in, not your actual work.
            </span>
          </div>

          {connected && (
            <>
              <Differences pack={pack} differences={env.differences} />

              <h4 className="stepLabel">What is out there</h4>
              {env.subjects.length === 0 ? (
                <p className="muted small">Nothing yet.</p>
              ) : (
                <div className="roleList">
                  {env.subjects.map((s) => {
                    const pair = env.matched.find((m) => m.external.id === s.id);
                    return (
                      <div key={s.id} className="row spread roleRow">
                        <div>
                          <strong>{s.name}</strong>
                          <span className="muted small">
                            {" "}
                            · {s.index}
                            {s.kind ? ` · ${s.kind}` : ""}
                          </span>
                        </div>
                        {pair ? (
                          env.canWrite ? (
                            <button
                              className="ghost"
                              onClick={() => void env.applyLabel(pair.subject, s.id)}
                              title="Write the board's label onto it"
                            >
                              Label
                            </button>
                          ) : (
                            <span className="chip ok">
                              {v.subject.one} {pair.subject}
                            </span>
                          )
                        ) : (
                          <span className="chip">not in this {v.run.one.toLowerCase()}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* The pretend environment needs to be able to both agree and
                  misbehave, or half the comparison cannot be demonstrated. */}
              <h4 className="stepLabel">Try it out</h4>
              <div className="exportRow">
                <button
                  className="ghost"
                  onClick={() => {
                    // Start from agreement: what a real environment would
                    // already hold if the player had been naming as they went.
                    for (const s of env.subjects) mock.remove(s.id);
                    for (const subject of state.subjects) {
                      if (!subject.removed && subject.type) mock.add(externalName(pack, subject));
                    }
                  }}
                  disabled={state.subjects.every((s) => !s.type)}
                >
                  Mirror the board
                </button>
                <button className="ghost" onClick={() => mock.add(`Thing ${env.subjects.length + 1}`)}>
                  Add one
                </button>
                <button
                  className="ghost"
                  onClick={() => env.subjects[0] && mock.rename(env.subjects[0].id, "Renamed")}
                  disabled={env.subjects.length === 0}
                >
                  Rename the first
                </button>
                <button className="ghost" onClick={() => mock.swap(0, 1)} disabled={env.subjects.length < 2}>
                  Swap two
                </button>
                <button
                  className="ghost"
                  onClick={() => env.subjects[0] && mock.remove(env.subjects[0].id)}
                  disabled={env.subjects.length === 0}
                >
                  Remove the first
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Differences({ pack, differences }: { pack: Pack; differences: readonly Difference[] }) {
  if (differences.length === 0) {
    return <p className="agreeing">Everything agrees.</p>;
  }
  return (
    <div className="notice">
      <ul className="noteList">
        {differences.map((d, i) => (
          <li key={i}>{describeDifference(pack, d)}</li>
        ))}
      </ul>
    </div>
  );
}
