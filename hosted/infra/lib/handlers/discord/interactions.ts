import { constrainedByOf, constraintsFor, type Pending } from "@runlog/engine";
import type { Pack } from "@runlog/rules-schema";
import { newCode } from "../races.js";
import { hashToken } from "../auth.js";
import type { GuildRun, GuildStore } from "../guilds.js";
import type { Store } from "../store.js";
import type { Notify } from "../live.js";
import { isCommandName } from "./commands.js";
import { customId, parseCustomId, cardFor, type Card } from "./card.js";
import { agendaFor, eventsOf, expireTimer, mayPress, openRun, packFor, play, type Seat, type TableAction, type TableDeps, type TimerJob } from "./play.js";
import type { DiscordRest } from "./rest.js";
import { EPHEMERAL, InteractionType, ResponseType, modal, nameOf, userOf, select, type CommandOption, type Interaction, type InteractionResponse } from "./types.js";

/**
 * What the bot says back.
 *
 * Discord sends each press here and waits three seconds for the answer,
 * so everything in this file answers in one turn: rows written, a
 * message returned, at most a post or two into the run's thread on the
 * way. Identity is Discord's word: the user in an interaction is who
 * Discord says pressed, signed by Discord, so linking and claiming need
 * no sign-in of their own on this side.
 *
 * A run is a session the host's Runlog account owns, played by the bot
 * from the server's vault: the host presses the card's buttons in the
 * run's thread, everyone in the server watches there and by live link,
 * and in a moderated mode anyone joins the roster and the host awards.
 */

export interface InteractionDeps {
  guilds: GuildStore;
  /** Where the app is, for the address a code is opened at. */
  appUrl: string;
  now: () => string;
  /** Codes are random by default; a test hands in its own. */
  code?: () => string;
  /** What a person has been granted, for the plan; absent, the plan is not spoken of. */
  grants?: (sub: string) => Promise<string[]>;
  /** What Stripe calls the server plan. */
  serverFeature?: string;
  /** Whether plans gate anything on this copy. */
  gates?: boolean;
  /** The sessions, for runs; absent, the bot links and sets up but hosts nothing. */
  store?: Store;
  notify?: Notify;
  rest?: DiscordRest | null;
  mintId?: () => string;
  token?: () => string;
  /**
   * Hand a slow interaction to a function with time: the handler answers
   * Discord "thinking" at once and the job finishes and fills the reply in.
   * Absent, everything is done in this turn, which a test and a small
   * copy prefer.
   */
  defer?: (interaction: Interaction) => Promise<void>;
  /** Somebody to come back when a timer runs out; see `TableDeps.schedule`. */
  schedule?: (job: TimerJob) => Promise<void>;
}

/** How long a link or claim code lasts. */
/**
 * What an interaction is, for the dashboard: the command with its
 * subcommand ("run start"), a press by its verb ("press:roll", "modal:
 * declared"), "ping" or "autocomplete". Never the arguments: a kind is
 * a dimension on a metric, and a dimension wants a few dozen values,
 * not one per run.
 */
export function kindOf(i: Interaction): string {
  switch (i.type) {
    case InteractionType.Ping:
      return "ping";
    case InteractionType.ApplicationCommand: {
      const name = i.data?.name ?? "command";
      const which = sub(i);
      return which && which.name !== name ? `${name} ${which.name}` : name;
    }
    case InteractionType.Autocomplete:
      return "autocomplete";
    case InteractionType.MessageComponent:
    case InteractionType.ModalSubmit: {
      const parsed = i.data?.custom_id ? parseCustomId(i.data.custom_id) : null;
      return `${i.type === InteractionType.ModalSubmit ? "modal" : "press"}:${parsed?.verb ?? "unknown"}`;
    }
    default:
      return "unknown";
  }
}

export const LINK_MINUTES = 10;

/** Discord's permission bits that mean "may manage this server": MANAGE_GUILD, or ADMINISTRATOR, which implies everything. */
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;

const ephemeral = (content: string): InteractionResponse => ({ type: ResponseType.ChannelMessage, data: { content: content.slice(0, 2000), flags: EPHEMERAL } });
const say = (content: string): InteractionResponse => ({ type: ResponseType.ChannelMessage, data: { content: content.slice(0, 2000) } });
const withCard = (type: number, card: Card, content?: string): InteractionResponse => ({ type, data: { ...(content ? { content } : {}), embeds: card.embeds, components: card.components } });

/** Whether the member who pressed may manage the server, by the permissions Discord computed for them. */
export function canManage(i: Interaction): boolean {
  const raw = i.member?.permissions;
  if (!raw || !/^\d{1,30}$/.test(raw)) return false;
  const bits = BigInt(raw);
  return (bits & ADMINISTRATOR) !== 0n || (bits & MANAGE_GUILD) !== 0n;
}

const sub = (i: Interaction): { name: string; options: CommandOption[] } | null => {
  const first = i.data?.options?.[0];
  return first && first.type === 1 ? { name: first.name, options: first.options ?? [] } : null;
};
const optionValue = (options: CommandOption[], name: string): string | null => {
  const v = options.find((o) => o.name === name)?.value;
  return typeof v === "string" ? v : null;
};
const optionNumber = (options: CommandOption[], name: string): number | null => {
  const v = options.find((o) => o.name === name)?.value;
  return typeof v === "number" && Number.isInteger(v) ? v : null;
};

export async function handleInteraction(i: Interaction, deps: InteractionDeps): Promise<InteractionResponse> {
  if (i.type === InteractionType.Ping) return { type: ResponseType.Pong };
  if (i.type === InteractionType.Autocomplete) return autocomplete(i, deps);
  if (i.type === InteractionType.MessageComponent || i.type === InteractionType.ModalSubmit) return pressed(i, deps);

  if (i.type === InteractionType.ApplicationCommand) {
    const name = i.data?.name;
    if (!isCommandName(name)) return ephemeral("That is not a command this bot knows. It may have been retired; try again later.");
    const who = userOf(i);
    if (!who) return ephemeral("Discord did not say who pressed, so there is nothing to do.");
    const home = deps.appUrl.replace(/\/$/, "");
    const at = deps.now();
    const expiresAt = new Date(Date.parse(at) + LINK_MINUTES * 60_000).toISOString();

    if (name === "link") {
      const already = await deps.guilds.userForDiscord(who.id);
      if (already) return ephemeral("This Discord account is already linked to a Runlog account. To link a different one, unlink it first from your Runlog profile, under Social.");
      const code = deps.code ? deps.code() : newCode();
      await deps.guilds.putLinkCode({ code, discordUserId: who.id, name: nameOf(who), ...(i.guild_id ? { guildId: i.guild_id } : {}), createdAt: at, expiresAt });
      return ephemeral(`Open this address signed in to Runlog, within ${LINK_MINUTES} minutes, and your accounts are linked:\n${home}/#link/discord?c=${code}\n\nOnly you can see this message. The code works once.`);
    }

    if (name === "setup") {
      if (!i.guild_id) return ephemeral("Setup is for a server; run it there.");
      if (!canManage(i)) return ephemeral("Setting up Runlog here takes someone who can manage the server.");
      const which = sub(i);
      const guild = await deps.guilds.guild(i.guild_id);

      if (which?.name === "claim") {
        const code = deps.code ? deps.code() : newCode();
        await deps.guilds.putClaimCode({ code, guildId: i.guild_id, discordUserId: who.id, createdAt: at, expiresAt });
        return ephemeral(
          `Open this address signed in to Runlog, within ${LINK_MINUTES} minutes, to claim this server for that account:\n${home}/#link/guild?c=${code}\n\n` +
            `The account that claims a server pays for its plan and chooses, from its own packs, what the bot plays here.${guild ? " This server is claimed already; claiming again moves it to the new account." : ""} Only you can see this message. The code works once.`,
        );
      }
      if (!guild) return ephemeral("This server is not claimed yet. Run /setup claim first.");

      if (which?.name === "role") {
        const roleId = optionValue(which.options, "role");
        await deps.guilds.updateGuild(i.guild_id, at, { hostRoleId: roleId });
        return ephemeral(roleId ? `Hosting runs here now takes the <@&${roleId}> role.` : "Anyone who can manage the server may host runs here now.");
      }
      if (which?.name === "channel") {
        const channelId = optionValue(which.options, "channel");
        await deps.guilds.updateGuild(i.guild_id, at, { channelId });
        return ephemeral(channelId ? `Runs open in <#${channelId}> by default now.` : "Runs open wherever /run is used now.");
      }
      if (which?.name === "status") {
        const owner = await deps.guilds.connection(guild.ownerSub);
        const packs = await deps.guilds.listGuildPacks(i.guild_id);
        const plan = !deps.gates
          ? "plans are open on this copy of Runlog"
          : deps.grants && (await deps.grants(guild.ownerSub)).includes(deps.serverFeature ?? "server")
            ? "Runlog for servers, active"
            : "no server plan yet; the account that claimed it subscribes from its Runlog profile, under Servers";
        const lines = [
          `**Runlog on ${guild.name ?? "this server"}**`,
          `Claimed by ${owner ? owner.name : "a Runlog account not linked to Discord"}.`,
          `Plan: ${plan}.`,
          `Hosts: ${guild.hostRoleId ? `<@&${guild.hostRoleId}>` : "anyone who can manage the server"}.`,
          `Runs open ${guild.channelId ? `in <#${guild.channelId}>` : "wherever /run is used"}.`,
          packs.length === 0 ? "Packs: none yet; the account that claimed the server adds them from its profile, under Servers." : `Packs: ${packs.map((p) => `${p.title} (${p.modes.map((m) => m.label).join(", ") || "one mode"})`).join("; ")}.`,
        ];
        return ephemeral(lines.join("\n"));
      }
      return ephemeral("Setup has claim, role, channel and status.");
    }

    if (name === "packs") {
      if (!i.guild_id) return ephemeral("Packs are a server's; ask in one.");
      const guild = await deps.guilds.guild(i.guild_id);
      if (!guild) return ephemeral("This server is not set up for Runlog yet. Someone who can manage it runs /setup claim.");
      const packs = await deps.guilds.listGuildPacks(i.guild_id);
      if (packs.length === 0) return ephemeral("No packs here yet. The account that claimed the server adds them from its Runlog profile, under Servers.");
      return ephemeral(packs.map((p) => `**${p.title}** — ${p.modes.map((m) => m.label).join(", ") || "one mode"}`).join("\n"));
    }

    if (name === "run") return runCommand(i, deps, who);

    if (name === "journal") {
      const table = tableDeps(deps);
      const run = i.channel_id ? await deps.guilds.guildRunByThread(i.channel_id) : null;
      if (!table || !run) return ephemeral("Write that in a run's thread.");
      if (run.endedAt) return ephemeral("This run has ended.");
      if (who.id !== run.hostDiscordId && !canManage(i)) return ephemeral("Only the host writes the journal.");
      const found = await packFor(deps.guilds, run.guildId, run.packId);
      if (!found) return ephemeral("This run's pack has left the server's vault, so the bot cannot read it any more.");
      const text = (i.data?.options?.find((o) => o.name === "text")?.value ?? "").toString().trim().slice(0, 500);
      if (!text) return ephemeral("Nothing to write.");
      const played = await play(table, run, found.pack, await seatOf(deps, who, i), { kind: "journal", text });
      if ("error" in played) return ephemeral(played.error);
      await afterPlay(table, played, { editCard: true, postLine: false });
      return say(played.line ?? "Written.");
    }
  }

  return ephemeral("Nothing to do with that yet.");
}

function tableDeps(deps: InteractionDeps): TableDeps | null {
  if (!deps.store || !deps.mintId) return null;
  return { store: deps.store, guilds: deps.guilds, rest: deps.rest ?? null, ...(deps.notify ? { notify: deps.notify } : {}), now: deps.now, mintId: deps.mintId, token: deps.token ?? (() => deps.mintId!()), appUrl: deps.appUrl, ...(deps.schedule ? { schedule: deps.schedule } : {}) };
}

/**
 * A timer's deadline came, by way of the schedule made when it started:
 * stop it and say so in the thread, on the card and to every live page.
 */
export async function timerRanOut(deps: InteractionDeps, job: TimerJob): Promise<"gone" | "later" | "stopped"> {
  const table = tableDeps(deps);
  if (!table) return "gone";
  const { outcome, played } = await expireTimer(table, job);
  if (played) await afterPlay(table, played, { editCard: true, postLine: true });
  return outcome;
}

/** Whether this member may host here: the host role where one is set, else anyone who can manage the server. */
function mayHost(i: Interaction, hostRoleId: string | undefined): boolean {
  if (hostRoleId) return (i.member?.roles ?? []).includes(hostRoleId) || canManage(i);
  return canManage(i);
}

async function runCommand(i: Interaction, deps: InteractionDeps, who: NonNullable<ReturnType<typeof userOf>>): Promise<InteractionResponse> {
  if (!i.guild_id) return ephemeral("Runs are hosted in a server; ask in one.");
  const table = tableDeps(deps);
  if (!table) return ephemeral("This copy of Runlog cannot host runs.");
  const which = sub(i);
  const guild = await deps.guilds.guild(i.guild_id);
  if (!guild) return ephemeral("This server is not set up for Runlog yet. Someone who can manage it runs /setup claim.");

  if (which?.name === "start") {
    if (!mayHost(i, guild.hostRoleId)) return ephemeral(guild.hostRoleId ? `Hosting a run here takes the <@&${guild.hostRoleId}> role.` : "Hosting a run here takes someone who can manage the server, until /setup role names a role.");
    const hostSub = await deps.guilds.userForDiscord(who.id);
    if (!hostSub) return ephemeral("A host needs a Runlog account linked, so the run is theirs: run /link first, then start again.");
    if (deps.gates && deps.grants && !(await deps.grants(guild.ownerSub)).includes(deps.serverFeature ?? "server")) {
      return ephemeral("Hosting runs here needs the server plan, which the account that claimed this server does not have yet. It subscribes from its Runlog profile, under Servers.");
    }
    const packId = optionValue(which.options, "pack") ?? "";
    const modeId = optionValue(which.options, "mode") ?? "";
    const name = optionValue(which.options, "name") ?? undefined;
    const players = optionNumber(which.options, "players") ?? undefined;
    const found = await packFor(deps.guilds, i.guild_id, packId);
    if (!found) return ephemeral("That pack is not in this server's vault. /packs lists what is.");
    const mode = found.pack.modes[modeId];
    if (!mode) return ephemeral(`${found.title} has no mode "${modeId}". Pick one from the list as you type.`);
    if (players !== undefined && (!mode.players || players < mode.players.min || players > mode.players.max)) {
      return ephemeral(mode.players ? `${mode.label} is played by ${mode.players.min === mode.players.max ? mode.players.min : `${mode.players.min} to ${mode.players.max}`}.` : `${mode.label} is played by one; leave players out.`);
    }
    const channelId = guild.channelId ?? i.channel_id;
    if (!channelId) return ephemeral("Nowhere to open the run: run this in a channel, or set one with /setup channel.");
    if (!table.rest) return ephemeral("The bot cannot post to Discord yet: its token is not filled in on this copy of Runlog.");
    // Everything that could refuse has had its say in this turn, to the
    // person alone. What is left — the session, the thread, the card, the
    // pin — is a handful of calls to Discord that a cold start plus three
    // seconds may not cover, so where there is a function with time, it
    // takes over from here.
    if (deps.defer) {
      await deps.defer(i);
      return { type: ResponseType.DeferredChannelMessage };
    }
    const opened = await openRun(table, { guildId: i.guild_id, channelId, pack: found.pack, packTitle: found.title, modeId, ...(name ? { name } : {}), ...(players !== undefined ? { players } : {}), host: { discordId: who.id, name: i.member?.nick?.trim() || nameOf(who), sub: hostSub } });
    if ("error" in opened) return ephemeral(opened.error);
    const modeLabel = found.pack.modes[modeId]?.label ?? modeId;
    return say(`**${nameOf(who)}** started **${found.title} · ${modeLabel}**${name ? ` — ${name}` : ""} in <#${opened.threadId}>. Watch it live: ${opened.link}`);
  }

  // The rest are said in the run's thread.
  const run = i.channel_id ? await deps.guilds.guildRunByThread(i.channel_id) : null;
  if (!run) return ephemeral("Say that in a run's thread.");
  const found = await packFor(deps.guilds, run.guildId, run.packId);
  if (!found) return ephemeral("This run's pack has left the server's vault, so the bot cannot read it any more.");

  if (which?.name === "status") {
    // A fresh card, posted so its id is known and recorded as the card;
    // the old one loses its buttons, so a press on it cannot drive the
    // table from a stale view.
    if (!table.rest) return ephemeral("The bot cannot post to Discord yet.");
    const events = await eventsOf(table.store, run.sessionId);
    const { state, agenda } = agendaFor(found.pack, events);
    const card = cardFor({ pack: found.pack, state, events, agenda, run, ...(run.pending ? { pending: run.pending as unknown as Pending } : {}) });
    const posted = await table.rest.postMessage(run.threadId, card);
    if (!posted) return ephemeral("Discord would not take the card just now; try again in a moment.");
    if (run.cardMessageId) await table.rest.editMessage(run.threadId, run.cardMessageId, { components: [] });
    run.cardMessageId = posted;
    run.updatedAt = deps.now();
    await deps.guilds.putGuildRun(run);
    return ephemeral("Posted a fresh card; the old one has no buttons now.");
  }
  if (which?.name === "link") {
    // A fresh token each time, the way the app shares again: only a hash is kept, so the old link cannot be repeated.
    const token = table.token();
    await table.store.updateSession(run.sessionId, deps.now(), { publicTokenHash: hashToken(token) });
    return say(`Watch it live, no account needed: ${deps.appUrl.replace(/\/$/, "")}/r/${encodeURIComponent(run.sessionId)}?t=${encodeURIComponent(token)}`);
  }
  if (which?.name === "end") {
    if (who.id !== run.hostDiscordId && !canManage(i)) return ephemeral("Only the host ends the run.");
    const endingId = optionValue(which.options, "ending") ?? found.pack.endings?.[0]?.id ?? "ended";
    const actor = await seatOf(deps, who, i);
    const played = await play(table, run, found.pack, actor, { kind: "end", ending: endingId });
    if ("error" in played) return ephemeral(played.error);
    await afterPlay(table, played, { editCard: true, postLine: false });
    return say(played.line ?? "The run is over.");
  }
  if (which?.name === "undo") {
    if (who.id !== run.hostDiscordId && !canManage(i)) return ephemeral("Only the host takes a move back.");
    if (run.endedAt) return ephemeral("This run has ended.");
    const played = await play(table, run, found.pack, await seatOf(deps, who, i), { kind: "undo" });
    if ("error" in played) return ephemeral(played.error);
    await afterPlay(table, played, { editCard: true, postLine: false });
    return say(played.line ?? "Taken back.");
  }
  return ephemeral("Run has start, status, link, end and undo.");
}

async function seatOf(deps: InteractionDeps, who: NonNullable<ReturnType<typeof userOf>>, i: Interaction): Promise<Seat> {
  return { discordId: who.id, name: i.member?.nick?.trim() || nameOf(who), sub: await deps.guilds.userForDiscord(who.id) };
}

/**
 * After a move: the line under the card, where the reply does not carry
 * it (a press updates the card and says nothing; a command's reply is the
 * line), and the pinned card edited where the press was not on it. The
 * thread is not closed at the end: a reply into a closed thread reopens
 * it, and Discord closes an idle one by itself.
 */
async function afterPlay(table: TableDeps, played: { line: string | null; run: GuildRun; ended: boolean; card: Card }, opts: { editCard: boolean; postLine: boolean }): Promise<void> {
  if (!table.rest) return;
  if (opts.postLine && played.line) await table.rest.postMessage(played.run.threadId, { content: played.line });
  if (opts.editCard && played.run.cardMessageId) await table.rest.editMessage(played.run.threadId, played.run.cardMessageId, played.card);
}

async function pressed(i: Interaction, deps: InteractionDeps): Promise<InteractionResponse> {
  const table = tableDeps(deps);
  const id = parseCustomId(i.data?.custom_id ?? "");
  const who = userOf(i);
  if (!table || !id || !who) return ephemeral("Nothing to do with that.");
  const run = await deps.guilds.guildRun(id.runId);
  if (!run) return ephemeral("This run is not one the bot hosts any more.");
  if (run.endedAt) return ephemeral("This run has ended.");
  const found = await packFor(deps.guilds, run.guildId, run.packId);
  if (!found) return ephemeral("This run's pack has left the server's vault, so the bot cannot read it any more.");
  const pack = found.pack;
  const actor = await seatOf(deps, who, i);
  const host = who.id === run.hostDiscordId || canManage(i);
  const anyone = ["join", "leave", "react", "wave", "seat", "unseat", "follow"].includes(id.verb);
  const hostOnly = ["end", "ending", "undo", "award"].includes(id.verb);
  // The host presses anything; whoever holds a seat presses the table; anyone joins, sits, waves or follows.
  if (!anyone && !host && !(mayPress(run, who.id) && !hostOnly)) {
    return ephemeral(run.seats ? `Only ${run.hostName} and whoever holds a seat press here. Take a seat, or watch by the live link.` : `Only the host, ${run.hostName}, presses here. Everyone else watches, here and by the live link.`);
  }

  // Two presses open a modal rather than move: the answer is typed.
  if (i.type === InteractionType.MessageComponent && id.verb === "declare") {
    const events = await eventsOf(table.store, run.sessionId);
    const { state, agenda } = agendaFor(pack, events);
    const hint = agenda.active ? constraintsFor(pack, state, constrainedByOf(agenda.active.step)).join("; ") : "";
    return modal(customId(run.sessionId, "declared"), `Declare the ${pack.vocabulary.subject.one.toLowerCase()}`, { id: "subject", label: `What is this ${pack.vocabulary.subject.one.toLowerCase()}?`, ...(hint ? { placeholder: hint } : {}) });
  }
  if (i.type === InteractionType.MessageComponent && id.verb === "text") {
    const label = run.pending && typeof (run.pending as { request?: { label?: string } }).request?.label === "string" ? (run.pending as { request: { label: string } }).request.label : "Your answer";
    return modal(customId(run.sessionId, "answered"), "Answer", { id: "answer", label, paragraph: true });
  }
  if (i.type === InteractionType.MessageComponent && id.verb === "end" && (pack.endings?.length ?? 0) > 1) {
    return { type: ResponseType.ChannelMessage, data: { content: "How does it end?", flags: EPHEMERAL, components: [select(customId(run.sessionId, "ending"), "The ending", pack.endings!.map((e) => ({ label: e.label, value: e.id })))] } };
  }

  const action = actionFor(id, i, run, pack);
  if (!action) return ephemeral("That press means nothing here any more; the card may be stale. /run status posts a fresh one.");
  const played = await play(table, run, pack, actor, action);
  if ("error" in played) return ephemeral(played.error);
  // The message pressed is updated in place by the answer; the pinned
  // card is edited too where the press was on some other message, so the
  // two never disagree. The ending menu lives on an ephemeral message,
  // whose reply is the line itself.
  const onCard = i.message?.id === played.run.cardMessageId;
  if (id.verb === "ending") {
    await afterPlay(table, played, { editCard: true, postLine: false });
    return say(played.line ?? "The run is over.");
  }
  await afterPlay(table, played, { editCard: !onCard, postLine: true });
  return withCard(ResponseType.UpdateMessage, played.card);
}

/** Which table action a press is, or null for one the card no longer offers. */
function actionFor(id: { verb: string; arg?: string }, i: Interaction, run: GuildRun, pack: Pack): TableAction | null {
  const pending = run.pending as unknown as Pending | undefined;
  const key = pending?.request.key;
  const picked = i.data?.values?.[0];
  const typed = i.data?.components?.[0]?.components?.[0]?.value?.trim();
  switch (id.verb) {
    case "enter":
      return { kind: "drive", action: { enter: true } };
    case "step":
      return { kind: "drive", action: { step: true } };
    case "finalize":
      return { kind: "drive", action: { finalize: true } };
    case "tick": {
      const index = Number(id.arg);
      if (!Number.isInteger(index)) return null;
      const on = i.message ? !((i.data?.custom_id ?? "") && messageTick(i, id.arg!)) : true;
      return { kind: "drive", action: { tick: { index, on } } };
    }
    case "move":
      return id.arg ? { kind: "drive", action: { move: id.arg } } : null;
    case "settle":
      return id.arg ? { kind: "drive", action: { settle: id.arg } } : null;
    case "declared":
      return typed ? { kind: "drive", action: { declare: typed.slice(0, 100) } } : null;
    case "join":
      return { kind: "join" };
    case "leave":
      return { kind: "leave" };
    case "award":
      return picked && id.arg ? { kind: "award", contestant: picked, outcome: Number(id.arg) } : null;
    case "end":
      return { kind: "end", ending: pack.endings?.[0]?.id ?? "ended" };
    case "undo":
      return { kind: "undo" };
    case "react":
      return id.arg ? { kind: "react", emoji: id.arg } : null;
    case "wave":
      return picked ? { kind: "react", emoji: picked } : null;
    case "seat":
      return id.arg && Number.isInteger(Number(id.arg)) ? { kind: "seat", seat: Number(id.arg) } : null;
    case "unseat":
      return { kind: "unseat" };
    case "follow":
      return { kind: "follow" };
    case "clock": {
      if (id.arg === "start") return { kind: "startClock" };
      const m = /^(pause|resume):(.+)$/.exec(id.arg ?? "");
      return m ? { kind: "clock", clock: m[2]!, to: m[1] === "pause" ? "paused" : "running" } : null;
    }
    case "ending":
      return picked ? { kind: "end", ending: picked } : null;
    case "yes":
      return key ? { kind: "answer", key, value: true } : null;
    case "no":
      return key ? { kind: "answer", key, value: false } : null;
    case "pick": {
      const options = pending?.request.kind === "prompt" ? (pending.request.options ?? []) : [];
      const choice = picked !== undefined ? options[Number(picked)] : undefined;
      return key && choice !== undefined ? { kind: "answer", key, value: choice } : null;
    }
    case "target":
      return key && picked ? { kind: "answer", key, value: Number(picked) } : null;
    case "answered":
      return key && typed ? { kind: "answer", key, value: typed.slice(0, 200) } : null;
    case "roll":
      return key ? { kind: "answer", key, value: 0 } : null;
    default:
      return null;
  }
}

/**
 * Whether the tick pressed is currently on: read from the card the press
 * came from, where the button's label carries the mark, so a toggle
 * flips what the person saw rather than what the log says an instant later.
 */
function messageTick(i: Interaction, index: string): boolean {
  const rows = (i as unknown as { message?: { components?: Array<{ components?: Array<{ custom_id?: string; label?: string }> }> } }).message?.components ?? [];
  for (const r of rows) for (const c of r.components ?? []) if (c.custom_id?.endsWith(`:tick:${index}`)) return (c.label ?? "").startsWith("☑");
  return false;
}

async function autocomplete(i: Interaction, deps: InteractionDeps): Promise<InteractionResponse> {
  const which = sub(i);
  const focused = which?.options.find((o) => o.focused);
  const typed = typeof focused?.value === "string" ? focused.value.toLowerCase() : "";
  const choices: Array<{ name: string; value: string }> = [];
  if (i.guild_id && which?.name === "start" && focused?.name === "pack") {
    for (const p of await deps.guilds.listGuildPacks(i.guild_id)) if (!typed || p.title.toLowerCase().includes(typed)) choices.push({ name: p.title, value: p.id });
  } else if (i.guild_id && which?.name === "start" && focused?.name === "mode") {
    const packId = optionValue(which.options, "pack") ?? "";
    const meta = (await deps.guilds.listGuildPacks(i.guild_id)).find((p) => p.id === packId);
    for (const m of meta?.modes ?? []) if (!typed || m.label.toLowerCase().includes(typed)) choices.push({ name: m.label, value: m.id });
  } else if (which?.name === "end" && focused?.name === "ending" && i.channel_id) {
    const run = await deps.guilds.guildRunByThread(i.channel_id);
    const found = run ? await packFor(deps.guilds, run.guildId, run.packId) : null;
    for (const e of found?.pack.endings ?? []) if (!typed || e.label.toLowerCase().includes(typed)) choices.push({ name: e.label, value: e.id });
  }
  return { type: ResponseType.AutocompleteResult, data: { choices: choices.slice(0, 25) } };
}
