import { SlashCommandBuilder } from "discord.js";
import { clampContent, requireGuildId } from "./shared.js";
import type { AppCommand } from "../types/appCommand.js";

function buildPrompt(instruction: string, queueSummary: string): string {
  return [
    "You are Jibboo, a concise Discord music assistant.",
    "Give practical responses only.",
    "Current queue context:",
    queueSummary,
    "",
    "User request:",
    instruction
  ].join("\n");
}

export const jibbooCommand: AppCommand = {
  name: "jibboo",
  controlChannelOnly: true,
  data: new SlashCommandBuilder()
    .setName("jibboo")
    .setDescription("Ask Jibboo for queue/music guidance.")
    .addStringOption((option) =>
      option
        .setName("instruction")
        .setDescription("What you want Jibboo to do")
        .setRequired(true)
    ),
  async execute(interaction, context) {
    const guildId = await requireGuildId(interaction);
    if (!guildId) {
      return;
    }

    const instruction = interaction.options.getString("instruction", true);
    const state = context.queueStore.getSnapshot(guildId);
    const queueSummary = [
      state.current
        ? `Now playing: ${state.current.title} (${state.current.url})`
        : "Now playing: nothing",
      `Queue length: ${state.queue.length}`,
      `Volume: ${state.volume}%`
    ].join("\n");

    await interaction.deferReply();

    try {
      const response = await context.integrations.gemini.generateReply(
        buildPrompt(instruction, queueSummary)
      );

      await interaction.editReply(clampContent(response));
    } catch (error) {
      console.error("Gemini request failed:", error);
      await interaction.editReply(
        "Gemini request failed. Check GEMINI_API_KEY / GEMINI_MODEL configuration."
      );
    }
  }
};
