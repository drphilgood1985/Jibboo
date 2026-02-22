import { SlashCommandBuilder } from "discord.js";
import { clampContent, requireGuildId } from "./shared.js";
import { formatNowPlaying, formatQueuePreview } from "../core/queueStore.js";
import type { AppCommand } from "../types/appCommand.js";

export const nowplayingCommand: AppCommand = {
  name: "nowplaying",
  controlChannelOnly: true,
  data: new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Show current track and queue preview."),
  async execute(interaction, context) {
    const guildId = await requireGuildId(interaction);
    if (!guildId) {
      return;
    }

    const state = context.queueStore.getSnapshot(guildId);

    await interaction.reply({
      content: clampContent([formatNowPlaying(state), formatQueuePreview(state)].join("\n"))
    });
  }
};
