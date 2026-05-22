import type { ChatInputCommandInteraction } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { QueueStore } from "../src/core/queueStore.js";
import { handleChatInputCommand } from "../src/discord/interactionHandler.js";

function createInteraction() {
  return {
    channelId: "1234",
    commandName: "stop",
    guildId: "guild-1",
    deferred: false,
    replied: false,
    user: { id: "user-1" },
    reply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    deleteReply: vi.fn(async () => undefined)
  };
}

function createContext(
  queueStore: QueueStore,
  options: { hasSession?: boolean; autoplayEnabled?: boolean } = {}
) {
  const voicePlayback = {
    hasSession: vi.fn(() => options.hasSession ?? false),
    stopAndDisconnect: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    playCurrent: vi.fn(async () => true),
    isPlayerIdle: vi.fn(() => true),
    isPlayerPaused: vi.fn(() => false),
    resume: vi.fn(),
    setVolume: vi.fn(),
    handleVoiceStateUpdate: vi.fn(async () => undefined)
  };
  const autoplay = {
    disable: vi.fn(() => options.autoplayEnabled ?? false)
  };

  return {
    controlChannelId: "1234",
    queueLimit: 50,
    watchTogetherApplicationId: "880218394199220334",
    queueStore,
    voicePlayback: voicePlayback as any,
    autoplay: autoplay as any,
    integrations: {
      gemini: { generateReply: vi.fn(async () => "unused") },
      youtube: {
        searchTopVideo: vi.fn(async () => null),
        searchSuggestions: vi.fn(async () => [])
      }
    }
  };
}

describe("/stop command", () => {
  it("stops playback, clears queue state, and disables autoplay", async () => {
    const interaction = createInteraction();
    const queueStore = new QueueStore();
    const context = createContext(queueStore, {
      hasSession: true,
      autoplayEnabled: true
    });

    queueStore.enqueue(
      "guild-1",
      {
        title: "Song A",
        videoId: "a",
        url: "https://www.youtube.com/watch?v=a",
        channelTitle: "Channel"
      },
      "user-1",
      "end"
    );
    queueStore.enqueue(
      "guild-1",
      {
        title: "Song B",
        videoId: "b",
        url: "https://www.youtube.com/watch?v=b",
        channelTitle: "Channel"
      },
      "user-1",
      "end"
    );

    await handleChatInputCommand(
      interaction as unknown as ChatInputCommandInteraction,
      context
    );

    const state = queueStore.getSnapshot("guild-1");
    expect(context.voicePlayback.stopAndDisconnect).toHaveBeenCalledWith("guild-1");
    expect(context.autoplay.disable).toHaveBeenCalledWith("guild-1");
    expect(state.current).toBeNull();
    expect(state.queue).toHaveLength(0);
    expect(state.history).toHaveLength(0);
    expect(interaction.editReply).toHaveBeenCalledWith(
      "Stopped playback and cleared 2 active/queued tracks.\nPlaylist autoplay stopped."
    );
  });

  it("returns a no-op message when nothing is playing", async () => {
    const interaction = createInteraction();
    const queueStore = new QueueStore();
    const context = createContext(queueStore);

    await handleChatInputCommand(
      interaction as unknown as ChatInputCommandInteraction,
      context
    );

    expect(context.voicePlayback.stopAndDisconnect).toHaveBeenCalledWith("guild-1");
    expect(interaction.editReply).toHaveBeenCalledWith("Nothing is currently playing.");
  });
});
