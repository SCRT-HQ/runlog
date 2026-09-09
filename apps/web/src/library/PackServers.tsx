import { useRef, useState } from "react";
import { useDismiss } from "../ui/useDismiss.ts";
import type { GuildVaults } from "./useGuildVaults.ts";
import type { StoredPack } from "../storage/db.ts";

/**
 * Which of this account's Discord servers may play this pack.
 *
 * The vault has always been filled from the server's side, under Profile,
 * where the question is "what may this server play". Standing at the shelf
 * the question is the other way round, "where may this pack be played",
 * and answering it meant leaving the shelf, finding the server, and
 * picking the pack out of a list of everything. So the same choice is
 * offered here as a box against each server's name.
 *
 * It draws nothing where there is no server to offer: an account with
 * none claimed, a copy with no bot behind it, or nobody signed in.
 */
export function PackServers({ pack, vaults }: { pack: StoredPack; vaults: GuildVaults }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);
  const [note, setNote] = useState<string | null>(null);
  useDismiss(root, open, () => setOpen(false));
  if (vaults.guilds.length === 0) return null;
  const on = vaults.guilds.filter((g) => vaults.holding[g.guildId]?.has(pack.id));
  return (
    <details ref={root} className="rowMenu packServers" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary title={`Which of your Discord servers may play ${pack.title}`}>
        {/* What it says when closed is the answer, not the question. */}
        {on.length === 0 ? "No server" : on.length === vaults.guilds.length ? "Every server" : `${on.length} of ${vaults.guilds.length} servers`}
      </summary>
      <div className="rowMenuPanel">
        <p className="muted small">
          The bot plays this pack in the servers ticked. Its text goes up once and stays there; members see what the dice draw, never the pack.
        </p>
        <ul className="docMenuList">
          {vaults.guilds.map((g) => {
            const held = Boolean(vaults.holding[g.guildId]?.has(pack.id));
            const working = vaults.busy === `${g.guildId}:${pack.id}`;
            return (
              <li key={g.guildId}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={held}
                    disabled={vaults.busy !== null}
                    onChange={(e) => void vaults.set(pack, g.guildId, e.target.checked).then(setNote)}
                  />
                  <span>{g.name ?? g.guildId}</span>
                </label>
                {working && <span className="muted small">Sending…</span>}
              </li>
            );
          })}
        </ul>
        {note && <p className="notice">{note}</p>}
      </div>
    </details>
  );
}
