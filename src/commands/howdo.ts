import { SlashCommandBuilder } from "discord.js";
import { replyEphemeral } from "../discord/channelPolicy.js";
import type { AppCommand } from "../types/appCommand.js";

const HOWDO_COMMANDS = [
  "`/play <text-or-url>`",
  "`/video <text-or-url>`",
  "`/playnext <input>`",
  "`/playlist <artist-or-genre>`",
  "`/next`",
  "`/previous`",
  "`/remove <number>`",
  "`/volume <0-100>`",
  "`/nowplaying`",
  "`/jibboo <instruction>`",
  "`/howdo`"
] as const;

export function buildHowdoMessage(controlChannelId: string, queueLimit: number): string {
  return [
    "Jibboo quick start:",
    `- Queue music: ${HOWDO_COMMANDS[0]}, ${HOWDO_COMMANDS[1]}, ${HOWDO_COMMANDS[2]}.`,
    `- Playlist mode: ${HOWDO_COMMANDS[3]} starts compatible autoplay; \`/playlist off\` stops it.`,
    `- Playback: ${HOWDO_COMMANDS[4]}, ${HOWDO_COMMANDS[5]}, ${HOWDO_COMMANDS[8]}.`,
    `- Edit queue: ${HOWDO_COMMANDS[6]} removes the numbered queued song shown under Queue. The current song is not #1; Queue #1 is the next song.`,
    `- Volume: ${HOWDO_COMMANDS[7]}.`,
    `- Assistant: ${HOWDO_COMMANDS[9]}.`,
    "- Control embed: buttons for Previous/Pause/Resume/Next/Volume, plus Suggestions to queue a recommended track next.",
    "- Default volume: 20%.",
    "",
    "Rules:",
    `- Run commands in <#${controlChannelId}>.`,
    "- Join a voice channel before /play, /playnext, /playlist, /video, /next, and /previous.",
    "- Playback stops when no human users remain in voice.",
    `- Queue limit: ${queueLimit} tracks.`,
    "",
    `Tip: Run ${HOWDO_COMMANDS[10]} anytime for this guide.`
  ].join("\n");
}

export const howdoCommand: AppCommand = {
  name: "howdo",
  controlChannelOnly: true,
  data: new SlashCommandBuilder()
    .setName("howdo")
    .setDescription("Get a brief guide to using Jibboo commands."),
  async execute(interaction, context) {
    const message = buildHowdoMessage(context.controlChannelId, context.queueLimit);
    await replyEphemeral(interaction, message);
  }
};
