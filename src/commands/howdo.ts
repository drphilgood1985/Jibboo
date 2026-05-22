import { SlashCommandBuilder } from "discord.js";
import {
  formatChannelList,
  normalizeChannelIds
} from "../discord/channelPolicy.js";
import type { AppCommand } from "../types/appCommand.js";

const HOWDO_COMMANDS = [
  "`/play <text-or-url>`",
  "`/video <text-or-url>`",
  "`/playnext <input>`",
  "`/suno <url>`",
  "`/sunonext <url>`",
  "`/playlist <artist-or-genre>`",
  "`/next`",
  "`/previous`",
  "`/remove <number>`",
  "`/volume <0-100>`",
  "`/nowplaying`",
  "`/jibboo <instruction>`",
  "`/howdo`"
] as const;

export function buildHowdoMessage(
  commandChannelIds: string | readonly string[],
  postChannelId: string,
  queueLimit: number
): string {
  const normalizedCommandChannelIds = normalizeChannelIds(commandChannelIds);
  const commandChannels = formatChannelList(normalizedCommandChannelIds);
  const shouldMentionPostChannel =
    !new Set(normalizedCommandChannelIds).has(postChannelId) ||
    normalizedCommandChannelIds.length > 1;

  const lines = [
    "Jibboo quick start:",
    `- Queue music: ${HOWDO_COMMANDS[0]}, ${HOWDO_COMMANDS[1]}, ${HOWDO_COMMANDS[2]}, ${HOWDO_COMMANDS[3]}, ${HOWDO_COMMANDS[4]}.`,
    `- Playlist mode: ${HOWDO_COMMANDS[5]} starts compatible autoplay; \`/playlist off\` stops it.`,
    `- Playback: ${HOWDO_COMMANDS[6]}, ${HOWDO_COMMANDS[7]}, ${HOWDO_COMMANDS[10]}.`,
    `- Edit queue: ${HOWDO_COMMANDS[8]} removes the numbered queued song shown under Queue. The current song is not #1; Queue #1 is the next song.`,
    `- Volume: ${HOWDO_COMMANDS[9]}.`,
    `- Assistant: ${HOWDO_COMMANDS[11]}.`,
    "- Control embed: buttons for Previous/Pause/Resume/Next/Volume, plus Suggestions to queue a recommended track next.",
    "- Default volume: 20%.",
    "",
    "Rules:",
    `- Run commands in ${commandChannels}.`,
    ...(shouldMentionPostChannel
      ? [`- Public bot posts go to <#${postChannelId}>.`]
      : []),
    "- Join a voice channel before /play, /playnext, /suno, /sunonext, /playlist, /video, /next, and /previous.",
    "- Playback stops when no human users remain in voice.",
    `- Queue limit: ${queueLimit} tracks.`,
    "",
    `Tip: Run ${HOWDO_COMMANDS[12]} anytime for this guide.`
  ];

  return lines.join("\n");
}

export const howdoCommand: AppCommand = {
  name: "howdo",
  controlChannelOnly: true,
  data: new SlashCommandBuilder()
    .setName("howdo")
    .setDescription("DM yourself a brief guide to using Jibboo commands."),
  async execute(interaction, context) {
    const postChannelId = context.postChannelId ?? context.controlChannelId;
    const commandChannelIds = context.commandChannelIds ?? [
      context.controlChannelId,
      postChannelId
    ];
    const message = buildHowdoMessage(commandChannelIds, postChannelId, context.queueLimit);

    await interaction.deferReply({ ephemeral: true });

    try {
      await interaction.user.send(message);
    } catch (error) {
      console.error("Failed to DM /howdo instructions:", error);
      await interaction.editReply(
        "I couldn't DM you instructions. Check your Discord privacy settings and try `/howdo` again."
      );
      return;
    }

    try {
      await interaction.deleteReply();
    } catch (error) {
      console.error("Failed to clear /howdo acknowledgement:", error);
    }
  }
};
