import type { Pack } from "@runlog/rules-schema";
import type { RunState } from "./types.ts";

/**
 * Who holds which role, this unit.
 *
 * Co-op here is the same-room, pass-the-device kind: nobody is identified, so
 * players are numbered by seating order and the roles walk around the table.
 * Doing it in the engine rather than the view keeps it a pure function of the
 * log — reopen the run tomorrow and the rotation has not lost its place.
 */

export interface RoleHolder {
  id: string;
  label: string;
  description?: string;
  /** 1-based seat, counting round the table from whoever started. */
  player: number;
}

/** The role configuration of the mode being played, if it has one. */
export function playerConfig(pack: Pack, state: RunState | null) {
  return pack.modes[state?.mode ?? pack.defaultMode]?.players;
}

/**
 * Roles assigned for a given unit.
 *
 * Rotation advances by one seat per closed unit, which is what "clockwise"
 * means at a table. Before the first unit is entered the assignment is shown
 * as it will stand for unit 1, so people know where to sit.
 */
export function rolesForUnit(pack: Pack, state: RunState | null, unit?: number): RoleHolder[] {
  const config = playerConfig(pack, state);
  const roles = config?.roles;
  if (!config || !roles || roles.length === 0) return [];

  const players = Math.max(1, state?.players ?? config.min);
  const at = Math.max(1, unit ?? state?.unit ?? 1);
  const shift = config.rotate === "clockwise" ? at - 1 : 0;

  return roles.map((role, index) => ({
    id: role.id,
    label: role.label,
    ...(role.description ? { description: role.description } : {}),
    player: ((index + shift) % players) + 1,
  }));
}
