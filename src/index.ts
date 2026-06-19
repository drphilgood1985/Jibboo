import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { AutoplayController } from "./core/autoplayController.js";
import { loadEnv } from "./config/env.js";
import { QueueStore } from "./core/queueStore.js";
import { VoicePlaybackController } from "./core/voicePlayback.js";
import { handleChatInputCommand } from "./discord/interactionHandler.js";
import { routePublicRepliesToChannel } from "./discord/interactionReplyRouter.js";
import { registerGuildCommands } from "./discord/registerGuildCommands.js";
import { createGeminiService } from "./integrations/geminiService.js";
import { createSpotifyService } from "./integrations/spotifyService.js";
import { createSunoService } from "./integrations/sunoService.js";
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
  }),
  suno: createSunoService(),
  spotify: createSpotifyService()
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
  "stop",
  "remove",
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
    await controlPanel.refreshForGuild(guild, env.postChannelId);
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
      postChannelId: env.postChannelId,
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
      commandChannelIds: env.commandChannelIds,
      postChannelId: env.postChannelId,
      queueLimit: env.queueLimit,
      watchTogetherApplicationId: env.watchTogetherApplicationId,
      queueStore,
      voicePlayback,
      autoplay,
      integrations
    });

    if (
      interaction.guild &&
      env.commandChannelIds.includes(interaction.channelId) &&
      PANEL_REFRESH_COMMANDS.has(interaction.commandName)
    ) {
      await controlPanel.refreshForGuild(interaction.guild, env.postChannelId);
    }
  } catch (error) {
    console.error("Command handling failed:", error);

    try {
      const routedInteraction = routePublicRepliesToChannel(interaction, env.postChannelId);
      if (interaction.deferred) {
        await routedInteraction.editReply(
          "Command failed unexpectedly. Check container logs for details."
        );
      } else if (!interaction.replied) {
        await routedInteraction.reply({
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
