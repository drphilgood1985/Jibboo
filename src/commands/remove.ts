import { SlashCommandBuilder } from "discord.js";
import { formatNowPlaying, formatQueuePreview } from "../core/queueStore.js";
import type { AppCommand } from "../types/appCommand.js";
import { clampContent, requireGuildId } from "./shared.js";

export const removeCommand: AppCommand = {
  name: "remove",
  controlChannelOnly: true,
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a track from the queue by queue number.")
    .addIntegerOption((option) =>
      option
        .setName("number")
        .setDescription("Queue number to remove, as shown in the Queue list")
        .setRequired(true)
        .setMinValue(1)
    ),
  async execute(interaction, context) {
    const guildId = await requireGuildId(interaction);
    if (!guildId) {
      return;
    }

    const position = interaction.options.getInteger("number", true);
    const result = context.queueStore.removeQueuedTrackAt(guildId, position);

    if (!result.removed) {
      await interaction.reply({
        content: clampContent(
          [
            `Couldn't remove #${position}. Pick a queued track number from the Queue list.`,
            formatNowPlaying(result.state),
            formatQueuePreview(result.state)
          ].join("\n")
        ),
        ephemeral: true
      });
      return;
    }

    await interaction.reply({
      content: clampContent(
        [
          `Removed #${position}: **${result.removed.title}**`,
          formatNowPlaying(result.state),
          formatQueuePreview(result.state)
        ].join("\n")
      )
    });
  }
};
