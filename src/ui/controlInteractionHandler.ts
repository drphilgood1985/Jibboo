import {
  GuildMember,
  type ButtonInteraction,
  type Guild,
  type StringSelectMenuInteraction,
  type VoiceBasedChannel
} from "discord.js";
import type { QueueStore } from "../core/queueStore.js";
import type { VoicePlaybackController } from "../core/voicePlayback.js";
import type { ControlPanelController } from "./controlPanel.js";
import { CONTROL_IDS } from "./controlPanel.js";

export interface ControlInteractionContext {
  controlChannelId: string;
  queueStore: QueueStore;
  voicePlayback: VoicePlaybackController;
  controlPanel: ControlPanelController;
}

type ControlInteraction = ButtonInteraction | StringSelectMenuInteraction;

async function getMemberVoiceChannel(
  interaction: ControlInteraction
): Promise<VoiceBasedChannel | null> {
  if (!interaction.guild) {
    return null;
  }

  const member =
    interaction.member instanceof GuildMember
      ? interaction.member
      : await interaction.guild.members.fetch(interaction.user.id);

  return member.voice.channel;
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(100, value));
}

async function withVoiceChannel(
  interaction: ControlInteraction,
  guild: Guild,
  context: ControlInteractionContext
): Promise<{ guildId: string; voiceChannel: VoiceBasedChannel } | null> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.followUp({
      content: "This control can only be used inside a server.",
      ephemeral: true
    });
    return null;
  }

  const voiceChannel = await getMemberVoiceChannel(interaction);
  if (!voiceChannel) {
    await interaction.followUp({
      content: "Join a voice channel first.",
      ephemeral: true
    });
    return null;
  }

  await context.voicePlayback.connect(guild, voiceChannel);

  return { guildId, voiceChannel };
}

async function handleButton(
  interaction: ButtonInteraction,
  context: ControlInteractionContext
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: "This control can only be used inside a server.",
      ephemeral: true
    });
    return;
  }

  if (interaction.channelId !== context.controlChannelId) {
    await interaction.reply({
      content: `Please use controls in <#${context.controlChannelId}>.`,
      ephemeral: true
    });
    return;
  }

  await interaction.deferUpdate();

  switch (interaction.customId) {
    case CONTROL_IDS.previous: {
      const target = await withVoiceChannel(interaction, guild, context);
      if (!target) {
        return;
      }

      context.queueStore.previous(target.guildId);
      await context.voicePlayback.playCurrent(target.guildId, true);
      break;
    }

    case CONTROL_IDS.next: {
      const target = await withVoiceChannel(interaction, guild, context);
      if (!target) {
        return;
      }

      context.queueStore.next(target.guildId);
      await context.voicePlayback.playCurrent(target.guildId, true);
      break;
    }

    case CONTROL_IDS.pause: {
      if (!interaction.guildId || !context.voicePlayback.pause(interaction.guildId)) {
        await interaction.followUp({
          content: "Nothing is currently playing to pause.",
          ephemeral: true
        });
      }
      break;
    }

    case CONTROL_IDS.resume: {
      if (!interaction.guildId || !context.voicePlayback.resume(interaction.guildId)) {
        await interaction.followUp({
          content: "Nothing is currently paused.",
          ephemeral: true
        });
      }
      break;
    }

    case CONTROL_IDS.volumeDown:
    case CONTROL_IDS.volumeUp: {
      const guildId = interaction.guildId;
      if (!guildId) {
        return;
      }

      const currentState = context.queueStore.getSnapshot(guildId);
      const delta = interaction.customId === CONTROL_IDS.volumeDown ? -10 : 10;
      const nextVolume = clampVolume(currentState.volume + delta);
      context.queueStore.setVolume(guildId, nextVolume);
      context.voicePlayback.setVolume(guildId, nextVolume);
      break;
    }

    default:
      return;
  }

  await context.controlPanel.refreshForGuild(guild, context.controlChannelId);
}

async function handleSuggestionSelect(
  interaction: StringSelectMenuInteraction,
  context: ControlInteractionContext
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: "This control can only be used inside a server.",
      ephemeral: true
    });
    return;
  }

  if (interaction.channelId !== context.controlChannelId) {
    await interaction.reply({
      content: `Please use controls in <#${context.controlChannelId}>.`,
      ephemeral: true
    });
    return;
  }

  await interaction.deferUpdate();

  if (!interaction.guildId) {
    return;
  }

  const selectedVideoId = interaction.values[0];
  if (!selectedVideoId) {
    await interaction.followUp({
      content: "No suggestion was selected.",
      ephemeral: true
    });
    return;
  }

  const selectedTrack = context.controlPanel.getSuggestion(interaction.guildId, selectedVideoId);
  if (!selectedTrack) {
    await interaction.followUp({
      content: "Suggestions were refreshed. Pick one from the latest list.",
      ephemeral: true
    });
    return;
  }

  const target = await withVoiceChannel(interaction, guild, context);
  if (!target) {
    return;
  }

  const hadSession = context.voicePlayback.hasSession(target.guildId);
  const enqueueResult = context.queueStore.enqueue(
    target.guildId,
    selectedTrack,
    interaction.user.id,
    "next"
  );

  if (
    enqueueResult.startedPlaying ||
    !hadSession ||
    context.voicePlayback.isPlayerIdle(target.guildId)
  ) {
    await context.voicePlayback.playCurrent(target.guildId, false);
  } else if (context.voicePlayback.isPlayerPaused(target.guildId)) {
    context.voicePlayback.resume(target.guildId);
  }

  await context.controlPanel.refreshForGuild(guild, context.controlChannelId);
}

export async function handleControlInteraction(
  interaction: ControlInteraction,
  context: ControlInteractionContext
): Promise<void> {
  try {
    if (interaction.isButton()) {
      await handleButton(interaction, context);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === CONTROL_IDS.suggestions) {
      await handleSuggestionSelect(interaction, context);
    }
  } catch (error) {
    console.error("Control interaction failed:", error);

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: "Control action failed. Check logs.",
        ephemeral: true
      });
      return;
    }

    await interaction.reply({
      content: "Control action failed. Check logs.",
      ephemeral: true
    });
  }
}
