import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { AutoplayController } from "./core/autoplayController.js";
import { loadEnv } from "./config/env.js";
import { QueueStore } from "./core/queueStore.js";
import { VoicePlaybackController } from "./core/voicePlayback.js";
import { handleChatInputCommand } from "./discord/interactionHandler.js";
import { registerGuildCommands } from "./discord/registerGuildCommands.js";
import { createGeminiService } from "./integrations/geminiService.js";
import { createYoutubeService } from "./integrations/youtubeService.js";
import { handleControlInteraction } from "./ui/controlInteractionHandler.js";
import { ControlPanelController } from "./ui/controlPanel.js";

const env = loadEnv();
const queueStore = new QueueStore();
const integrations = {
  gemini: createGeminiService({
    apiKey: env.geminiApiKey,
    model: env.geminiModel
  }),
  youtube: createYoutubeService({
    apiKey: env.youtubeApiKey,
    ytdlpCookiesPath: env.ytdlpCookiesPath
  })
};
const controlPanel = new ControlPanelController(
  queueStore,
  integrations.youtube,
  integrations.gemini
);
const autoplay = new AutoplayController(queueStore, integrations.youtube, env.queueLimit);

const PANEL_REFRESH_COMMANDS = new Set([
  "play",
  "video",
  "playnext",
  "playlist",
  "next",
  "previous",
  "volume",
  "nowplaying"
]);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});
let voicePlayback: VoicePlaybackController | null = null;

voicePlayback = new VoicePlaybackController(
  queueStore,
  env.noListenerGraceSeconds,
  async (guildId) => {
    if (!voicePlayback) {
      return;
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return;
    }

    await autoplay.handlePlaybackStateChange(guild, voicePlayback);
    await controlPanel.refreshForGuild(guild, env.controlChannelId);
  },
  env.ytdlpCookiesPath
);

client.once("ready", () => {
  console.log(`Logged in as ${client.user?.tag ?? "unknown-user"}`);
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    if (!voicePlayback) {
      return;
    }

    await handleControlInteraction(interaction, {
      controlChannelId: env.controlChannelId,
      queueStore,
      voicePlayback,
      controlPanel
    });
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    if (!voicePlayback) {
      throw new Error("Voice playback is not initialized.");
    }

    await handleChatInputCommand(interaction, {
      controlChannelId: env.controlChannelId,
      queueLimit: env.queueLimit,
      watchTogetherApplicationId: env.watchTogetherApplicationId,
      queueStore,
      voicePlayback,
      autoplay,
      integrations
    });

    if (
      interaction.guild &&
      interaction.channelId === env.controlChannelId &&
      PANEL_REFRESH_COMMANDS.has(interaction.commandName)
    ) {
      await controlPanel.refreshForGuild(interaction.guild, env.controlChannelId);
    }
  } catch (error) {
    console.error("Command handling failed:", error);

    try {
      if (interaction.deferred) {
        await interaction.editReply(
          "Command failed unexpectedly. Check container logs for details."
        );
      } else if (!interaction.replied) {
        await interaction.reply({
          content: "Command failed unexpectedly. Check container logs for details.",
          ephemeral: true
        });
      }
    } catch (replyError) {
      console.error("Failed to send command error reply:", replyError);
    }
  }
});

client.on("voiceStateUpdate", (oldState, newState) => {
  if (!voicePlayback) {
    return;
  }

  const guild = newState.guild ?? oldState.guild;
  void voicePlayback.handleVoiceStateUpdate(guild);
});

async function start(): Promise<void> {
  try {
    const commandCount = await registerGuildCommands(env);
    console.log(`Registered ${commandCount} guild commands during startup.`);
  } catch (error) {
    console.error("Guild command registration failed during startup:", error);
  }

  await client.login(env.discordToken);
}

start().catch((error) => {
  console.error("Discord startup failed:", error);
  process.exitCode = 1;
});
