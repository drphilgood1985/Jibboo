import { SlashCommandBuilder } from "discord.js";
import { requireGuildId, requireMemberVoiceChannel } from "./shared.js";
import type { AppCommand } from "../types/appCommand.js";

export const volumeCommand: AppCommand = {
  name: "volume",
  controlChannelOnly: true,
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set playback volume from 0 to 100.")
    .addIntegerOption((option) =>
      option
        .setName("percent")
        .setDescription("Volume percentage")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)
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

    try {
      const guild = interaction.guild;
      if (guild) {
        await context.voicePlayback.connect(guild, voiceChannel);
      }

      const percent = interaction.options.getInteger("percent", true);
      const state = context.queueStore.setVolume(guildId, percent);
      context.voicePlayback.setVolume(guildId, state.volume);

      await interaction.reply({
        content: `Volume set to ${state.volume}%.`
      });
    } catch (error) {
      console.error("Failed to set volume:", error);
      await interaction.reply({
        content: "Could not set voice volume. Check bot voice permissions.",
        ephemeral: true
      });
    }
  }
};
