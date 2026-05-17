import { SlashCommandBuilder } from "discord.js";
import { clampContent, requireGuildId } from "./shared.js";
import { formatNowPlaying, formatQueuePreview } from "../core/queueStore.js";
import type { AppCommand } from "../types/appCommand.js";

type QueueEditAction =
  | { kind: "remove"; position: number }
  | { kind: "clear" };

function buildPrompt(instruction: string, queueSummary: string): string {
  return [
    "You are Jibboo, a concise Discord music assistant.",
    "Give practical responses only.",
    "Important: this command cannot directly mutate queue state.",
    "Never claim you already changed the queue, playback, or volume.",
    "If a user asks for a mutation, provide exact slash-command steps instead.",
    "Current queue context:",
    queueSummary,
    "",
    "User request:",
    instruction
  ].join("\n");
}

function parseQueueEditAction(instruction: string): QueueEditAction | null {
  const removeMatch = instruction.match(
    /\b(?:remove|delete|drop)\b(?:\s+(?:track|song|item))?\s*#?\s*(\d+)\b/i
  );
  if (removeMatch?.[1]) {
    const position = Number.parseInt(removeMatch[1], 10);
    if (position > 0) {
      return { kind: "remove", position };
    }
  }

  if (
    /\b(?:clear|empty|wipe)\b(?:\s+(?:the\s+)?)?queue\b/i.test(instruction) ||
    /\b(?:remove|delete)\b\s+all\b.*\bqueue\b/i.test(instruction)
  ) {
    return { kind: "clear" };
  }

  return null;
}

function isLikelyQueueEditIntent(instruction: string): boolean {
  const hasActionVerb =
    /\b(remove|delete|drop|clear|empty|wipe|move|swap|reorder|shuffle|skip|set|change|adjust|volume|mute|unmute)\b/i.test(
      instruction
    );
  const hasQueueTarget =
    /\b(queue|track|song|playlist|volume)\b/i.test(instruction) || /#\d+\b/.test(instruction);

  return hasActionVerb && hasQueueTarget;
}

function queueEditHelpMessage(): string {
  return [
    "I can only apply these queue edits directly via `/jibboo` right now:",
    "- `remove #<queue-position>`",
    "- `clear queue`",
    "For queue removal, you can also use `/remove <number>`.",
    "For other changes, use slash commands: `/play`, `/playnext`, `/next`, `/previous`, `/volume`."
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

    const queueEditAction = parseQueueEditAction(instruction);
    if (queueEditAction?.kind === "remove") {
      const result = context.queueStore.removeQueuedTrackAt(guildId, queueEditAction.position);

      if (!result.removed) {
        await interaction.reply({
          content: clampContent(
            [
              `Couldn't remove #${queueEditAction.position}.`,
              formatNowPlaying(result.state),
              formatQueuePreview(result.state)
            ].join("\n")
          )
        });
        return;
      }

      await interaction.reply({
        content: clampContent(
          [
            `Removed #${queueEditAction.position}: **${result.removed.title}**`,
            formatNowPlaying(result.state),
            formatQueuePreview(result.state)
          ].join("\n")
        )
      });
      return;
    }

    if (queueEditAction?.kind === "clear") {
      const result = context.queueStore.clearQueue(guildId);
      const noun = result.cleared === 1 ? "track" : "tracks";

      await interaction.reply({
        content: clampContent(
          [
            `Cleared ${result.cleared} queued ${noun}.`,
            formatNowPlaying(result.state),
            formatQueuePreview(result.state)
          ].join("\n")
        )
      });
      return;
    }

    if (isLikelyQueueEditIntent(instruction)) {
      await interaction.reply({
        content: queueEditHelpMessage(),
        ephemeral: true
      });
      return;
    }

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
