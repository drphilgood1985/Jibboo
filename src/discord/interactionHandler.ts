import type { ChatInputCommandInteraction } from "discord.js";
import { commandMap } from "./commandRegistry.js";
import {
  isInControlChannel,
  replyControlChannelOnly,
  replyEphemeral
} from "./channelPolicy.js";
import type { CommandContext } from "../types/appCommand.js";

export async function handleChatInputCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const command = commandMap.get(interaction.commandName);
  if (!command) {
    await replyEphemeral(interaction, "Unknown command.");
    return;
  }

  if (
    command.controlChannelOnly &&
    !isInControlChannel(interaction, context.controlChannelId)
  ) {
    await replyControlChannelOnly(interaction, context.controlChannelId);
    return;
  }

  await command.execute(interaction, context);
}
