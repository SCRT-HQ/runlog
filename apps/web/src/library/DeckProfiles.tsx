import { useRef, useState } from "react";
import { loadPackText, type Pack } from "@runlog/rules-schema";
import { DEVICES, DEVICE_IDS, container, hasKeys, profile, specs, type DeviceId } from "@runlog/deck-profiles";
import { builtins } from "../control/builtin.ts";
import { forTool, setupsHere } from "../control/setups.ts";
import { useDismiss } from "../ui/useDismiss.ts";

/**
 * A Stream Deck profile for this pack, built here and downloaded.
 *
 * The plugin ships a profile for every pack in the repository, laid out by
 * `streamdeck/design/profiles.mjs` and committed. A pack from the
 * Marketplace was not there when the plugin was packed, so its own page
 * runs the same generator, `@runlog/deck-profiles`, on the pack it is
 * showing: its moves on keys, its counters and resources on the numbers,
 * and the setups for whatever tool drives it ready to hand out. What comes
 * out is the same `.streamDeckProfile` the plugin would have shipped, to be
 * imported once in the Stream Deck app.
 *
 * The pack's text is read when somebody opens this rather than when the
 * card is drawn. A marketplace listing's text comes over the network, and
 * fetching twenty packs to decide whether to draw twenty rows nobody asked
 * for is a page that costs what it does not spend.
 */
export function DeckProfiles({ load, format = "yaml" }: { load: () => Promise<string>; format?: "yaml" | "json" }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);
  const [pack, setPack] = useState<Pack | null>(null);
  /** Set once the pack has been read and has nothing of its own to lay out. */
  const [nothing, setNothing] = useState(false);
  /** Set where the pack could not be read at all, which is a different answer. */
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<DeviceId | null>(null);
  /** Whether a read is in flight, so opening twice does not fetch twice. */
  const reading = useRef(false);
  useDismiss(root, open, () => setOpen(false));

  if (nothing) return null;

  /**
   * Read the pack, once.
   *
   * Three answers, and they are not the same. A pack that reads and has
   * moves, counters or resources gets the decks. A pack that reads and has
   * none of them has nothing a profile could carry, so the row goes: there
   * is nothing to offer and no fault to report. A pack that could not be
   * read at all, a fetch that did not answer or text that does not parse,
   * says so and stays where it is, because a row that vanished would tell
   * somebody this pack has no keys when nobody knows whether it does.
   */
  const read = async () => {
    if (pack || failed || reading.current) return;
    reading.current = true;
    try {
      const parsed = loadPackText(await load(), format);
      if (!parsed.ok) setFailed(true);
      else if (hasKeys(parsed.pack)) setPack(parsed.pack);
      else setNothing(true);
    } catch {
      setFailed(true);
    } finally {
      reading.current = false;
    }
  };

  const download = async (device: DeviceId) => {
    if (!pack) return;
    setBusy(device);
    try {
      // The tool is the pack's, from the control profile written for it;
      // the setups are the tool's, because a setup names a tool and no pack
      // at all. A pack nothing is written for gets no setup keys.
      const tool = (await builtins()).find((b) => b.pack === pack.id)?.profile.tool;
      const setups = forTool(await setupsHere(), tool);
      const bytes = container(profile(specs(pack, setups, device)[0]!));
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${pack.id}-${device}.streamDeckProfile`;
      a.click();
      // The object URL must outlive the download the click started.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setBusy(null);
    }
  };

  return (
    <details
      ref={root}
      className="rowMenu deckProfiles"
      open={open}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (e.currentTarget.open) void read();
      }}
    >
      <summary title="A profile for your Stream Deck, laid out from this pack">Stream Deck profile</summary>
      <div className="rowMenuPanel">
        {failed ? (
          <p className="muted small">Could not read the pack.</p>
        ) : pack === null ? (
          <p className="muted small">Loading…</p>
        ) : (
          <>
            <p className="muted small">Import the file in the Stream Deck app.</p>
            <div className="options">
              {DEVICE_IDS.map((device) => (
                <button key={device} className="chip pick" disabled={busy !== null} onClick={() => void download(device)}>
                  {busy === device ? "Building…" : DEVICES[device].label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </details>
  );
}
