import { SlashCommandBuilder } from "discord.js";
import { formatNowPlaying, formatQueuePreview } from "../core/queueStore.js";
import type { AppCommand } from "../types/appCommand.js";
import { clampContent, requireGuildId, requireMemberVoiceChannel } from "./shared.js";

function createSunoCommand(name: "suno" | "sunonext", mode: "end" | "next"): AppCommand {
  return {
    name,
    controlChannelOnly: true,
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        mode === "next"
          ? "Queue a public Suno song to play next."
          : "Queue a public Suno song from a shared Suno URL."
      )
      .addStringOption((option) =>
        option
          .setName("url")
          .setDescription("Suno song URL, for example https://suno.com/song/... or https://suno.com/s/...")
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

      const suno = context.integrations.suno;
      if (!suno) {
        await interaction.reply({
          content: "Suno queueing is not available in this build.",
          ephemeral: true
        });
        return;
      }

      const input = interaction.options.getString("url", true);

      await interaction.deferReply();

      try {
        const result = await suno.resolveSong(input);
        if (!result) {
          await interaction.editReply(
            "No playable public Suno song was found. Use a Suno `/song/...` or `/s/...` share URL."
          );
          return;
        }

        const enqueueResult = context.queueStore.enqueue(
          guildId,
          result,
          interaction.user.id,
          mode
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

        const queuedLine =
          mode === "next"
            ? `Queued for next: **${result.title}**`
            : `Added to queue: **${result.title}**`;

        const lines = enqueueResult.startedPlaying
          ? [
              `Now playing: **${result.title}**`,
              "Source: Suno audio.",
              `Requested by <@${interaction.user.id}>.`,
              result.pageUrl
            ]
          : [
              queuedLine,
              "Source: Suno audio.",
              result.pageUrl,
              formatNowPlaying(enqueueResult.state),
              formatQueuePreview(enqueueResult.state)
            ];

        await interaction.editReply(clampContent(lines.join("\n")));
      } catch (error) {
        console.error("Failed to enqueue/play Suno track:", error);
        await interaction.editReply(
          "Could not play this Suno request. Check that the Suno link is public and that ffmpeg/yt-dlp can reach the Suno CDN."
        );
      }
    }
  };
}

export const sunoCommand = createSunoCommand("suno", "end");
export const sunonextCommand = createSunoCommand("sunonext", "next");
