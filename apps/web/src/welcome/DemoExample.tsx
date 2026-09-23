import type { ReactNode } from "react";
import type { DemoExample, DemoLine, DemoWidget } from "./demoScenario.ts";

/**
 * Pure, accessible rendering of one generated example.
 *
 * `DemoSpecimen`, `DemoWidgets` and `DemoHistory` all read the same
 * resolved `DemoExample` and nothing else: no hooks, no loading state, no
 * pack access, no random generation. Every dynamic string, a pack's own
 * prose, a contestant's name, a rolled result, goes through ordinary React
 * interpolation, so it is always text and never markup, and nothing a
 * player would want read aloud sits behind `aria-hidden`.
 */

function SpecimenLine({ line }: { line: DemoLine }) {
  return (
    <li className={line.heat ? "heat" : undefined} data-line-id={line.id}>
      <span className="where">{line.where}</span>
      <span className="roll">{line.roll}</span>
      <p>{line.text}</p>
    </li>
  );
}

/** The hero: the example's full log and its running state, labeled as what it is. */
export function DemoSpecimen({ example, packHref }: { example: DemoExample; packHref: string }): ReactNode {
  return (
    <figure className="specimen" aria-label="An example run, as Runlog writes it">
      <figcaption className="muted small">
        Example · <a href={packHref}>{example.packTitle}</a> · {example.modeLabel} · {example.at}
      </figcaption>
      <ol className="specimenLog">
        {example.lines.map((line) => (
          <SpecimenLine key={line.id} line={line} />
        ))}
      </ol>
      <div className="specimenState">
        {example.state.map((entry) => (
          <span key={entry.label}>
            <b>{entry.label}</b> {entry.value}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Lines from the same example, for the section that shows what the log remembers, labeled as an example like the hero. */
export function DemoHistory({ example }: { example: DemoExample }): ReactNode {
  const byId = new Map(example.lines.map((line) => [line.id, line]));
  const lines = example.historyLineIds.flatMap((id) => {
    const line = byId.get(id);
    return line ? [line] : [];
  });
  return (
    <figure className="specimen welcomeExcerpt" aria-label="Lines from this example run">
      <figcaption className="muted small">Example</figcaption>
      <ol className="specimenLog">
        {lines.map((line) => (
          <SpecimenLine key={line.id} line={line} />
        ))}
      </ol>
    </figure>
  );
}

function ScoreboardPanel({ widget }: { widget: Extract<DemoWidget, { kind: "scoreboard" }> }) {
  return (
    <div className="widgetBody">
      <div className="widgetTitle muted small">Scoreboard · {widget.title}</div>
      <ol className="widgetBoard">
        {widget.rows.map((row) => (
          <li key={row.name}>
            <span className="place">#{row.place}</span>
            <span className="who">{row.name}</span>
            <span className="num">{row.points}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The step in play. The generator never hands this widget the pack's bare
 * finalize step (its own "press to close the unit," with nothing else to
 * say), so whatever text arrives here is a real instruction. The
 * constraints list may be the step's own constraints or, when it has none,
 * the current unit's results; either way it is shown plainly, with no
 * heading that would claim which one it is.
 */
function StepPanel({ widget }: { widget: Extract<DemoWidget, { kind: "step" }> }) {
  return (
    <div className="widgetBody">
      <div className="widgetTitle muted small">{widget.title}</div>
      <div className="widgetStep">{widget.text}</div>
      {widget.constraints.length > 0 && (
        <ul className="widgetList">
          {widget.constraints.map((line, i) => (
            <li key={i}>
              <p>{line}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrackersPanel({ widget }: { widget: Extract<DemoWidget, { kind: "trackers" }> }) {
  return (
    <div className="widgetBody">
      <div className="widgetTitle muted small">{widget.title}</div>
      <dl className="widgetStats">
        {widget.rows.map((row) => (
          <div key={row.label}>
            <dt className="muted small">{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The one line the ticker names, read back from the same lines the hero and the history show. */
function TickerPanel({ widget, example }: { widget: Extract<DemoWidget, { kind: "ticker" }>; example: DemoExample }) {
  const line = example.lines.find((l) => l.id === widget.lineId);
  if (!line) return null;
  return (
    <div className="widgetBody">
      <div className="widgetTitle muted small">{widget.title}</div>
      <ol className="widgetTicker">
        <li data-line-id={line.id}>
          <span className="tickMark small">{line.roll}</span>
          <span className="tickText">{line.text}</span>
        </li>
      </ol>
    </div>
  );
}

function ClockPanel({ widget }: { widget: Extract<DemoWidget, { kind: "clock" }> }) {
  return (
    <div className="widgetBody clock">
      <div className="widgetTitle muted small">{widget.title}</div>
      <div className="widgetDigits">{widget.value}</div>
    </div>
  );
}

/** The example's widget panels, stacked the way a stream would capture them, captioned with the same run's own words. */
export function DemoWidgets({ example }: { example: DemoExample }): ReactNode {
  return (
    <figure className="welcomeWidget" aria-label="Example widgets, drawn from the same run">
      {example.widgets.map((widget, i) => {
        switch (widget.kind) {
          case "scoreboard":
            return <ScoreboardPanel key={i} widget={widget} />;
          case "step":
            return <StepPanel key={i} widget={widget} />;
          case "trackers":
            return <TrackersPanel key={i} widget={widget} />;
          case "ticker":
            return <TickerPanel key={i} widget={widget} example={example} />;
          case "clock":
            return <ClockPanel key={i} widget={widget} />;
        }
      })}
      <figcaption className="muted small">{example.widgetCaption}</figcaption>
    </figure>
  );
}
