import type { ChatInputCommandInteraction } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { QueueStore } from "../src/core/queueStore.js";
import { handleChatInputCommand } from "../src/discord/interactionHandler.js";

function createVoicePlaybackStub() {
  return {
    hasSession: vi.fn(() => false),
    connect: vi.fn(async () => undefined),
    playCurrent: vi.fn(async () => false),
    skipToNext: vi.fn(async () => undefined),
    skipToPrevious: vi.fn(async () => undefined),
    setVolume: vi.fn(),
    stopAndDisconnect: vi.fn(async () => undefined),
    handleVoiceStateUpdate: vi.fn(async () => undefined)
  };
}

type MockInteraction = {
  channelId: string;
  commandName: string;
  guildId: string | null;
  guild?: unknown;
  deferred: boolean;
  replied: boolean;
  options: {
    getInteger: ReturnType<typeof vi.fn>;
  };
  reply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  deleteReply: ReturnType<typeof vi.fn>;
};

function createInteraction(position: number): MockInteraction {
  return {
    channelId: "1234",
    commandName: "remove",
    guildId: "guild-1",
    deferred: false,
    replied: false,
    options: {
      getInteger: vi.fn(() => position)
    },
    reply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    deferReply: vi.fn(async () => undefined),
    deleteReply: vi.fn(async () => undefined)
  };
}

function createContext(queueStore: QueueStore) {
  return {
    controlChannelId: "1234",
    queueLimit: 50,
    watchTogetherApplicationId: "880218394199220334",
    queueStore,
    voicePlayback: createVoicePlaybackStub() as any,
    integrations: {
      gemini: { generateReply: vi.fn(async () => "unused") },
      youtube: {
        searchTopVideo: vi.fn(async () => null),
        searchSuggestions: vi.fn(async () => [])
      }
    }
  };
}

function createRedirectContext(queueStore: QueueStore) {
  return {
    ...createContext(queueStore),
    controlChannelId: "chat-channel",
    commandChannelIds: ["chat-channel", "dj-channel"],
    postChannelId: "dj-channel"
  };
}

function createGuildWithPostChannel(send: ReturnType<typeof vi.fn>): unknown {
  return {
    channels: {
      cache: {
        get: vi.fn(() => ({
          isTextBased: () => true,
          send
        }))
      },
      fetch: vi.fn(async () => null)
    }
  };
}

function seedQueue(queueStore: QueueStore): void {
  for (const track of [
    { title: "Song A", videoId: "a" },
    { title: "Song B", videoId: "b" },
    { title: "Song C", videoId: "c" }
  ]) {
    queueStore.enqueue(
      "guild-1",
      {
        title: track.title,
        videoId: track.videoId,
        url: `https://www.youtube.com/watch?v=${track.videoId}`,
        channelTitle: "Channel"
      },
      "user-1",
      "end"
    );
  }
}

describe("/remove command", () => {
  it("removes the requested queued track by queue number", async () => {
    const interaction = createInteraction(2);
    const queueStore = new QueueStore();
    seedQueue(queueStore);

    await handleChatInputCommand(
      interaction as unknown as ChatInputCommandInteraction,
      createContext(queueStore)
    );

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Removed #2: **Song C**")
      })
    );

    const state = queueStore.getSnapshot("guild-1");
    expect(state.current?.title).toBe("Song A");
    expect(state.queue.map((track) => track.title)).toEqual(["Song B"]);
  });

  it("leaves the queue unchanged for an unknown queue number", async () => {
    const interaction = createInteraction(9);
    const queueStore = new QueueStore();
    seedQueue(queueStore);

    await handleChatInputCommand(
      interaction as unknown as ChatInputCommandInteraction,
      createContext(queueStore)
    );

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Couldn't remove #9"),
        ephemeral: true
      })
    );

    const state = queueStore.getSnapshot("guild-1");
    expect(state.current?.title).toBe("Song A");
    expect(state.queue.map((track) => track.title)).toEqual(["Song B", "Song C"]);
  });

  it("routes immediate public replies from chat to the post channel", async () => {
    const interaction = createInteraction(2);
    const postSend = vi.fn(async () => ({ id: "message-1" }));
    interaction.channelId = "chat-channel";
    interaction.guild = createGuildWithPostChannel(postSend);
    const queueStore = new QueueStore();
    seedQueue(queueStore);

    await handleChatInputCommand(
      interaction as unknown as ChatInputCommandInteraction,
      createRedirectContext(queueStore)
    );

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(postSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Removed #2: **Song C**")
      })
    );
    expect(interaction.deleteReply).toHaveBeenCalledTimes(1);
  });
});
