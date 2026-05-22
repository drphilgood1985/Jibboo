import { SlashCommandBuilder } from "discord.js";
import { requireGuildId } from "./shared.js";
import type { AppCommand } from "../types/appCommand.js";

export const stopCommand: AppCommand = {
  name: "stop",
  controlChannelOnly: true,
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback, disconnect, and clear the active queue."),
  async execute(interaction, context) {
    const guildId = await requireGuildId(interaction);
    if (!guildId) {
      return;
    }

    await interaction.deferReply();

    const hadSession = context.voicePlayback.hasSession(guildId);
    const autoplayWasEnabled = context.autoplay?.disable(guildId) ?? false;
    const result = context.queueStore.clearPlayback(guildId);

    try {
      await context.voicePlayback.stopAndDisconnect(guildId);
    } catch (error) {
      console.error("Failed to stop playback:", error);
      await interaction.editReply("Could not stop playback cleanly. Check bot voice permissions.");
      return;
    }

    if (!hadSession && result.cleared === 0 && !autoplayWasEnabled) {
      await interaction.editReply("Nothing is currently playing.");
      return;
    }

    const noun = result.cleared === 1 ? "track" : "tracks";
    const autoplayLine = autoplayWasEnabled ? "\nPlaylist autoplay stopped." : "";

    await interaction.editReply(
      `Stopped playback and cleared ${result.cleared} active/queued ${noun}.${autoplayLine}`
    );
  }
};
