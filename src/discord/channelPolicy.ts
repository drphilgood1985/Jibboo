import type { ChatInputCommandInteraction, InteractionReplyOptions } from "discord.js";

export function normalizeChannelIds(channelIds: string | readonly string[]): string[] {
  return [...new Set(Array.isArray(channelIds) ? channelIds : [channelIds])];
}

export function formatChannelList(channelIds: string | readonly string[]): string {
  const mentions = normalizeChannelIds(channelIds).map((channelId) => `<#${channelId}>`);

  if (mentions.length <= 1) {
    return mentions[0] ?? "the configured channel";
  }

  const lastMention = mentions[mentions.length - 1] ?? "the configured channel";
  return `${mentions.slice(0, -1).join(", ")} or ${lastMention}`;
}

export function isInControlChannel(
  interaction: ChatInputCommandInteraction,
  controlChannelIds: string | readonly string[]
): boolean {
  return normalizeChannelIds(controlChannelIds).includes(interaction.channelId);
}

export function buildControlChannelGuidance(
  controlChannelIds: string | readonly string[]
): string {
  return `Please run this command in ${formatChannelList(controlChannelIds)}.`;
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
  controlChannelIds: string | readonly string[]
): Promise<void> {
  await replyEphemeral(interaction, buildControlChannelGuidance(controlChannelIds));
}
