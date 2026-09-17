import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { controlClasses, type ButtonSize } from "./Button.tsx";
import { useDismiss } from "./useDismiss.ts";

/**
 * The errands, folded away behind one button.
 *
 * A card or a row usually has one thing people came to press and four or
 * five they press once a month. Left side by side the errands compete
 * with the thing, so the errands go here: a labeled button that opens a
 * list, each line a press, the destructive one at the foot behind a rule.
 * What must stay in sight, an update waiting, a license that blocks play,
 * an import that failed, never goes in a menu: it changes what the next
 * press should be, and a person cannot weigh what they cannot see.
 *
 * The keyboard: the button says it opens a menu and whether it is open,
 * opening puts focus on the first line, the arrows walk the lines and
 * wrap, Home and End jump, Escape closes and hands focus back to the
 * button, Tab closes it the same way and then moves on from the button
 * rather than from a line that is no longer there, and a press outside closes
 * it. Escape belongs to whatever opened last, so a menu inside a dialog
 * closes on the first press and the dialog on the second; that part is
 * `useDismiss`, which every popover in the app already shares.
 *
 * The lines are the caller's, so a menu can hold a group, a submenu that
 * opens in place, or a line that presses a hidden file input. Whatever
 * they are, they carry `role="menuitem"`; that is what the arrows walk.
 */
export function Menu({
  label,
  title,
  size = "compact",
  className,
  children,
}: {
  /** What the button says. `More` where the lines are errands. */
  label: ReactNode;
  title?: string;
  size?: ButtonSize;
  className?: string;
  /** The lines, given a way to close the menu once one of them has done its work. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useDismiss(root, open, () => setOpen(false));

  /** The lines as they stand now: a submenu opened in place is walked with the rest. */
  const items = () =>
    Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []).filter((el) => !el.matches(":disabled"));

  const step = (by: number) => {
    const all = items();
    if (all.length === 0) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = at < 0 ? (by > 0 ? 0 : all.length - 1) : (at + by + all.length) % all.length;
    all[next]?.focus();
  };

  // Opening puts the keyboard on the first line: a menu that opens with
  // focus left on the button takes an extra press to use without a mouse.
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  const close = (toButton = true) => {
    setOpen(false);
    if (toButton) button.current?.focus();
  };

  return (
    <div className={`menu${className ? ` ${className}` : ""}`} ref={root}>
      <button
        ref={button}
        type="button"
        id={id}
        className={controlClasses({ size }, "menuButton")}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label}{" "}
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={panel}
          className="menuPanel"
          role="menu"
          aria-labelledby={id}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              step(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              step(-1);
            } else if (e.key === "Home") {
              e.preventDefault();
              items()[0]?.focus();
            } else if (e.key === "End") {
              e.preventDefault();
              items().at(-1)?.focus();
            } else if (e.key === "Escape") {
              // Handled here, and not left to the document, so focus goes
              // back to the button that opened it rather than to the page.
              e.preventDefault();
              e.stopPropagation();
              close();
            } else if (e.key === "Tab") {
              // Focus goes back to the button before the browser moves it
              // on, so Tab leaves from the menu rather than from wherever
              // the page puts focus when the line under it disappears.
              close();
            }
          }}
        >
          {children(() => close())}
        </div>
      )}
    </div>
  );
}

/**
 * One line of a menu.
 *
 * `danger` is the tone for a line that destroys something; it belongs at
 * the foot, under a `MenuRule`, so it is never the line beside the one
 * somebody meant to press.
 */
export function MenuItem({
  children,
  note,
  tone = "plain",
  title,
  disabled,
  expanded,
  onSelect,
}: {
  children: ReactNode;
  /** A quiet word at the right: what the line will produce, or what it costs. */
  note?: ReactNode;
  tone?: "plain" | "danger";
  title?: string;
  disabled?: boolean;
  /** Set where the line opens more lines under it rather than doing something. */
  expanded?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menuItem${tone === "danger" ? " danger" : ""}`}
      title={title}
      disabled={disabled}
      aria-expanded={expanded}
      onClick={onSelect}
    >
      <span>{children}</span>
      {note !== undefined && <span className="muted small">{note}</span>}
    </button>
  );
}

/** Lines that belong together, named: the documents, the decks. */
export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="menuGroup" role="group" aria-label={label}>
      {/* Named twice on purpose: the group carries the name for a screen
          reader, and this is the same name for everybody else. */}
      <span className="menuGroupLabel muted small" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}

/** The line between the errands and the one that destroys something. */
export function MenuRule() {
  return <div className="menuRule" role="separator" />;
}
