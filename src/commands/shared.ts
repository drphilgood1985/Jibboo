import { GuildMember, type ChatInputCommandInteraction, type VoiceBasedChannel } from "discord.js";

export async function requireGuildId(
  interaction: ChatInputCommandInteraction
): Promise<string | null> {
  const guildId = interaction.guildId;
  if (guildId) {
    return guildId;
  }

  await interaction.reply({
    content: "This command can only be used inside a server.",
    ephemeral: true
  });

  return null;
}

export async function requireMemberVoiceChannel(
  interaction: ChatInputCommandInteraction
): Promise<VoiceBasedChannel | null> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used inside a server.",
      ephemeral: true
    });
    return null;
  }

  const member =
    interaction.member instanceof GuildMember
      ? interaction.member
      : await interaction.guild.members.fetch(interaction.user.id);

  const voiceChannel = member.voice.channel;
  if (!voiceChannel) {
    await interaction.reply({
      content: "Join a voice channel first.",
      ephemeral: true
    });
    return null;
  }

  return voiceChannel;
}

export function clampContent(content: string, maxLength = 1900): string {
  return content.length > maxLength ? `${content.slice(0, maxLength)}...` : content;
}
