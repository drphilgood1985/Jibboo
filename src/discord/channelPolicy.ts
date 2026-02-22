import type { ChatInputCommandInteraction, InteractionReplyOptions } from "discord.js";

export function isInControlChannel(
  interaction: ChatInputCommandInteraction,
  controlChannelId: string
): boolean {
  return interaction.channelId === controlChannelId;
}

export function buildControlChannelGuidance(controlChannelId: string): string {
  return `Please run this command in <#${controlChannelId}>.`;
}

export async function replyEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string
): Promise<void> {
  const payload: InteractionReplyOptions = {
    content,
    ephemeral: true
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload);
    return;
  }

  await interaction.reply(payload);
}

export async function replyControlChannelOnly(
  interaction: ChatInputCommandInteraction,
  controlChannelId: string
): Promise<void> {
  await replyEphemeral(interaction, buildControlChannelGuidance(controlChannelId));
}
