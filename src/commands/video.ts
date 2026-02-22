import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { requireGuildId, requireMemberVoiceChannel } from "./shared.js";
import type { AppCommand } from "../types/appCommand.js";

export const videoCommand: AppCommand = {
  name: "video",
  controlChannelOnly: true,
  data: new SlashCommandBuilder()
    .setName("video")
    .setDescription("Search YouTube videos, embed the result, and play audio in voice.")
    .addStringOption((option) =>
      option
        .setName("input")
        .setDescription("Video title or YouTube URL text")
        .setRequired(true)
    ),
  async execute(interaction, context) {
    const guildId = await requireGuildId(interaction);
    if (!guildId) {
      return;
    }

    const voiceChannel = await requireMemberVoiceChannel(interaction);
    if (!voiceChannel) {
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: "This command can only be used inside a server.",
        ephemeral: true
      });
      return;
    }

    const input = interaction.options.getString("input", true);

    await interaction.deferReply();

    try {
      const result = await context.integrations.youtube.searchTopVideo(input, "video");
      if (!result) {
        await interaction.editReply("No matching YouTube video was found.");
        return;
      }

      const enqueueResult = context.queueStore.enqueue(
        guildId,
        result,
        interaction.user.id,
        "end"
      );

      const hadSession = context.voicePlayback.hasSession(guildId);
      await context.voicePlayback.connect(guild, voiceChannel);

      if (
        enqueueResult.startedPlaying ||
        !hadSession ||
        context.voicePlayback.isPlayerIdle(guildId)
      ) {
        await context.voicePlayback.playCurrent(guildId, false);
      } else if (context.voicePlayback.isPlayerPaused(guildId)) {
        context.voicePlayback.resume(guildId);
      }

      const embed = new EmbedBuilder()
        .setTitle(result.title)
        .setURL(result.url)
        .setDescription(`Channel: ${result.channelTitle}\nNeed help using Jibboo? Run \`/howdo\`.`)
        .setColor(0xe53935)
        .setFooter({
          text: enqueueResult.startedPlaying
            ? "Playing video audio in voice. Need help? /howdo."
            : "Added video to queue. Need help? /howdo."
        });

      if (result.thumbnailUrl) {
        embed.setThumbnail(result.thumbnailUrl);
      }

      await interaction.editReply({
        content: enqueueResult.startedPlaying
          ? `Now playing video audio for <@${interaction.user.id}>.\n${result.url}`
          : `Added video to queue for <@${interaction.user.id}>.\n${result.url}`,
        embeds: [embed]
      });
    } catch (error) {
      console.error("Failed to enqueue/play video:", error);
      await interaction.editReply(
        "Could not play this video request. Check voice permissions, ffmpeg, and yt-dlp."
      );
    }
  }
};
