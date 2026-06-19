import { SlashCommandBuilder } from "discord.js";
import {
  formatChannelList,
  normalizeChannelIds
} from "../discord/channelPolicy.js";
import type { AppCommand } from "../types/appCommand.js";

const HOWDO_COMMANDS = [
  "`/play <text-or-url>`",
  "`/video <text-or-url>`",
  "`/playnext <text-or-url>`",
  "`/playlist <artist-or-genre>`",
  "`/next`",
  "`/previous`",
  "`/stop`",
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
    `- Queue music: ${HOWDO_COMMANDS[0]} and ${HOWDO_COMMANDS[2]} accept song text, YouTube links, Spotify track links, Suno links, or other playable links. ${HOWDO_COMMANDS[1]} queues a video result and posts an embed.`,
    `- Playlist mode: ${HOWDO_COMMANDS[3]} starts compatible autoplay; \`/playlist off\` stops it.`,
    `- Playback: ${HOWDO_COMMANDS[4]}, ${HOWDO_COMMANDS[5]}, ${HOWDO_COMMANDS[9]}. ${HOWDO_COMMANDS[6]} stops playback, disconnects, clears the active queue, and stops playlist autoplay.`,
    `- Edit queue: ${HOWDO_COMMANDS[7]} removes the numbered queued song shown under Queue. The current song is not #1; Queue #1 is the next song.`,
    `- Volume: ${HOWDO_COMMANDS[8]}.`,
    `- Assistant: ${HOWDO_COMMANDS[10]}.`,
    "- Control embed: buttons for Previous/Pause/Resume/Next/Volume, plus Suggestions to queue a recommended track next.",
    "- Default volume: 20%.",
    "",
    "Rules:",
    `- Run commands in ${commandChannels}.`,
    ...(shouldMentionPostChannel
      ? [`- Public bot posts go to <#${postChannelId}>.`]
      : []),
    "- Join a voice channel before /play, /playnext, /playlist, /video, /next, and /previous. /stop can be used from the command channel without joining voice.",
    "- Playback stops when no human users remain in voice.",
    `- Queue limit: ${queueLimit} tracks.`,
    "",
    `Tip: Run ${HOWDO_COMMANDS[11]} anytime for this guide.`
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
