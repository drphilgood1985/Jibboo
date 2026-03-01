import { SlashCommandBuilder } from "discord.js";
import { isPlaylistStopInput } from "../core/autoplayController.js";
import { formatNowPlaying, formatQueuePreview } from "../core/queueStore.js";
import type { AppCommand } from "../types/appCommand.js";
import { clampContent, requireGuildId, requireMemberVoiceChannel } from "./shared.js";

export const playlistCommand: AppCommand = {
  name: "playlist",
  controlChannelOnly: true,
  data: new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("Enable artist/genre autoplay, or run `/playlist off` to stop.")
    .addStringOption((option) =>
      option
        .setName("input")
        .setDescription("Artist or genre, for example synthwave, gunship, or sublime")
        .setRequired(false)
    ),
  async execute(interaction, context) {
    const guildId = await requireGuildId(interaction);
    if (!guildId) {
      return;
    }

    const autoplay = context.autoplay;
    if (!autoplay) {
      await interaction.reply({
        content: "Playlist autoplay is not available in this build.",
        ephemeral: true
      });
      return;
    }

    const rawInput = interaction.options.getString("input")?.trim() ?? "";
    if (rawInput.length === 0) {
      const currentSession = autoplay.getSession(guildId);
      const message = currentSession
        ? `Playlist autoplay is active for **${currentSession.query}**.\nRun \`/playlist off\` to stop it.`
        : "Start autoplay with `/playlist <artist-or-genre>` (for example `/playlist synthwave`).";

      await interaction.reply({
        content: message,
        ephemeral: true
      });
      return;
    }

    if (isPlaylistStopInput(rawInput)) {
      const wasEnabled = autoplay.disable(guildId);
      await interaction.reply({
        content: wasEnabled
          ? "Playlist autoplay stopped."
          : "Playlist autoplay was not enabled."
      });
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

    await interaction.deferReply();

    try {
      const stateBefore = context.queueStore.getSnapshot(guildId);
      const totalTracks = (stateBefore.current ? 1 : 0) + stateBefore.queue.length;
      if (totalTracks >= context.queueLimit) {
        await interaction.editReply(
          `Queue is full (${context.queueLimit} tracks). Use /next or /previous, then try again.`
        );
        return;
      }

      const result = await context.integrations.youtube.searchTopVideo(rawInput, "music");
      if (!result) {
        await interaction.editReply("No matching YouTube Music track was found for that playlist seed.");
        return;
      }

      autoplay.enable(guildId, rawInput, interaction.user.id);

      const enqueueResult = context.queueStore.enqueue(
        guildId,
        result,
        interaction.user.id,
        "end"
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
            `Playlist mode enabled: **${rawInput}**`,
            `Now playing: **${result.title}**`,
            `Source: YouTube Music audio (${result.channelTitle}).`,
            `Requested by <@${interaction.user.id}>.`,
            "Autoplay will continue until `/playlist off` or the voice channel is empty.",
            "Building compatible follow-ups in the background."
          ]
        : [
            `Playlist mode enabled: **${rawInput}**`,
            `Seed track added: **${result.title}**`,
            `Source: YouTube Music audio (${result.channelTitle}).`,
            "Autoplay will continue until `/playlist off` or the voice channel is empty.",
            "Building compatible follow-ups in the background.",
            formatNowPlaying(enqueueResult.state),
            formatQueuePreview(enqueueResult.state)
          ];

      await interaction.editReply(clampContent(lines.join("\n")));

      void autoplay.refillForGuild(guild, context.voicePlayback).catch((error) => {
        console.error("Background autoplay refill failed:", error);
      });
    } catch (error) {
      console.error("Failed to start playlist autoplay:", error);
      autoplay.disable(guildId);
      await interaction.editReply(
        "Could not start playlist autoplay. Check YOUTUBE_API_KEY, voice permissions, ffmpeg, and yt-dlp."
      );
    }
  }
};
