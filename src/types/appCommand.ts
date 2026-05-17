import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder
} from "discord.js";
import type { QueueStore } from "../core/queueStore.js";
import type { VoicePlaybackController } from "../core/voicePlayback.js";
import type { AutoplayController } from "../core/autoplayController.js";
import type { IntegrationClients } from "../integrations/types.js";

export interface CommandContext {
  controlChannelId: string;
  commandChannelIds?: readonly string[];
  postChannelId?: string;
  queueLimit: number;
  watchTogetherApplicationId: string;
  queueStore: QueueStore;
  voicePlayback: VoicePlaybackController;
  autoplay?: AutoplayController;
  integrations: IntegrationClients;
}

export interface AppCommand {
  name: string;
  controlChannelOnly: boolean;
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  execute: (
    interaction: ChatInputCommandInteraction,
    context: CommandContext
  ) => Promise<void>;
}
