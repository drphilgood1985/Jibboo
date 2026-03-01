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
  "`/volume <0-100>`",
  "`/nowplaying`",
  "`/jibboo <instruction>`",
  "`/howdo`"
] as const;

export function buildHowdoMessage(controlChannelId: string, queueLimit: number): string {
  return [
    "Jibboo quick start:",
    `- ${HOWDO_COMMANDS[0]} queues music (YouTube Music-biased) and plays in voice.`,
    `- ${HOWDO_COMMANDS[1]} queues a video result, embeds it in chat, and plays audio in voice.`,
    `- ${HOWDO_COMMANDS[2]} inserts a track to play immediately after the current track.`,
    `- ${HOWDO_COMMANDS[3]} enables endless compatible autoplay (example: \`/playlist synthwave\`, \`/playlist gunship\`, \`/playlist sublime\`).`,
    "- Run `/playlist off` to stop autoplay.",
    `- ${HOWDO_COMMANDS[4]}, ${HOWDO_COMMANDS[5]}, ${HOWDO_COMMANDS[6]}, ${HOWDO_COMMANDS[7]}, ${HOWDO_COMMANDS[8]}`,
    `- Use the control embed buttons for Previous/Pause/Resume/Next/Volume.`,
    "- Use the Suggestions dropdown to queue a recommended track as play-next.",
    "- Default volume is 20% for new queues.",
    "",
    "Rules:",
    `- Run commands in <#${controlChannelId}>.`,
    "- Join a voice channel before /play, /playnext, /playlist, /video, /next, and /previous.",
    "- Playback stops when no human users remain in voice.",
    `- Queue limit: ${queueLimit} tracks.`,
    "",
    `Tip: Run ${HOWDO_COMMANDS[9]} anytime for this guide.`
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
