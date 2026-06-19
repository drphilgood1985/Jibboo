import { SlashCommandBuilder } from "discord.js";
import { clampContent, requireGuildId, requireMemberVoiceChannel } from "./shared.js";
import { formatNowPlaying, formatQueuePreview } from "../core/queueStore.js";
import type { AppCommand } from "../types/appCommand.js";
import { resolveInputMedia } from "./mediaResolver.js";

export const playnextCommand: AppCommand = {
  name: "playnext",
  controlChannelOnly: true,
  data: new SlashCommandBuilder()
    .setName("playnext")
    .setDescription("Search YouTube Music or queue a supported link next.")
    .addStringOption((option) =>
      option
        .setName("input")
        .setDescription("Song name, YouTube/Spotify/Suno URL, or other playable link")
        .setRequired(true)
    ),
  async execute(interaction, context) {
    const guildId = await requireGuildId(interaction);
    if (!guildId) {
      return;
    }

    const voiceChannel = await requireMemberVoiceChannel(interaction);
    if (!voiceChannel) {
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: "This command can only be used inside a server.",
        ephemeral: true
      });
      return;
    }

    const input = interaction.options.getString("input", true);

    await interaction.deferReply();

    try {
      const resolved = await resolveInputMedia(input, context);
      const result = resolved.media;
      if (!result) {
        await interaction.editReply(resolved.notFoundMessage);
        return;
      }

      const enqueueResult = context.queueStore.enqueue(
        guildId,
        result,
        interaction.user.id,
        "next"
      );

      const hadSession = context.voicePlayback.hasSession(guildId);
      await context.voicePlayback.connect(guild, voiceChannel);

      if (
        enqueueResult.startedPlaying ||
        !hadSession ||
        context.voicePlayback.isPlayerIdle(guildId)
      ) {
        await context.voicePlayback.playCurrent(guildId, false);
      } else if (context.voicePlayback.isPlayerPaused(guildId)) {
        context.voicePlayback.resume(guildId);
      }

      const lines = enqueueResult.startedPlaying
        ? [
            `Now playing: **${result.title}**`,
            `Source: ${result.sourceName ?? "YouTube Music"} audio (${result.channelTitle}).`,
            `Requested by <@${interaction.user.id}>.`
          ]
        : [
            `Queued for next: **${result.title}**`,
            `Source: ${result.sourceName ?? "YouTube Music"} audio (${result.channelTitle}).`,
            formatNowPlaying(enqueueResult.state),
            formatQueuePreview(enqueueResult.state)
          ];

      await interaction.editReply(clampContent(lines.join("\n")));
    } catch (error) {
      console.error("Failed to enqueue/play-next track:", error);
      await interaction.editReply(
        "Could not queue this for next. Check YOUTUBE_API_KEY, voice permissions, ffmpeg, and yt-dlp."
      );
    }
  }
};
