import { SlashCommandBuilder } from "discord.js";
import { clampContent, requireGuildId, requireMemberVoiceChannel } from "./shared.js";
import { formatNowPlaying, formatQueuePreview } from "../core/queueStore.js";
import type { AppCommand } from "../types/appCommand.js";

export const nextCommand: AppCommand = {
  name: "next",
  controlChannelOnly: true,
  data: new SlashCommandBuilder()
    .setName("next")
    .setDescription("Skip to the next queued track."),
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

    try {
      await context.voicePlayback.connect(guild, voiceChannel);

      const state = context.queueStore.next(guildId);
      await context.voicePlayback.playCurrent(guildId, true);

      await interaction.reply({
        content: clampContent([formatNowPlaying(state), formatQueuePreview(state)].join("\n"))
      });
    } catch (error) {
      console.error("Failed to skip track:", error);
      await interaction.reply({
        content: "Could not skip track in voice. Check bot voice permissions and ffmpeg/yt-dlp.",
        ephemeral: true
      });
    }
  }
};
