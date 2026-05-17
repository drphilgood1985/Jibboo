import { SlashCommandBuilder } from "discord.js";
import { clampContent, requireGuildId, requireMemberVoiceChannel } from "./shared.js";
import { formatNowPlaying, formatQueuePreview } from "../core/queueStore.js";
import type { AppCommand } from "../types/appCommand.js";

export const previousCommand: AppCommand = {
  name: "previous",
  controlChannelOnly: true,
  data: new SlashCommandBuilder()
    .setName("previous")
    .setDescription("Replay the previous track from history."),
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
      return;
    }

    await interaction.deferReply();

    try {
      await context.voicePlayback.connect(guild, voiceChannel);

      const state = await context.voicePlayback.skipToPrevious(guildId);

      await interaction.editReply(
        clampContent([formatNowPlaying(state), formatQueuePreview(state)].join("\n"))
      );
    } catch (error) {
      console.error("Failed to go to previous track:", error);
      await interaction.editReply(
        "Could not play previous track in voice. Check bot voice permissions and ffmpeg/yt-dlp."
      );
    }
  }
};
