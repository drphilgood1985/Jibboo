import type { ChatInputCommandInteraction } from "discord.js";
import { commandMap } from "./commandRegistry.js";
import {
  isInControlChannel,
  replyControlChannelOnly,
  replyEphemeral
} from "./channelPolicy.js";
import { routePublicRepliesToChannel } from "./interactionReplyRouter.js";
import type { CommandContext } from "../types/appCommand.js";

export async function handleChatInputCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext
): Promise<void> {
  const postChannelId = context.postChannelId ?? context.controlChannelId;
  const commandChannelIds = context.commandChannelIds ?? [
    context.controlChannelId,
    postChannelId
  ];
  const command = commandMap.get(interaction.commandName);
  if (!command) {
    const responseInteraction = isInControlChannel(interaction, commandChannelIds)
      ? routePublicRepliesToChannel(interaction, postChannelId)
      : interaction;
    await replyEphemeral(responseInteraction, "Unknown command.");
    return;
  }

  if (
    command.controlChannelOnly &&
    !isInControlChannel(interaction, commandChannelIds)
  ) {
    await replyControlChannelOnly(interaction, commandChannelIds);
    return;
  }

  const routedInteraction = routePublicRepliesToChannel(interaction, postChannelId);
  await command.execute(routedInteraction, context);
}
