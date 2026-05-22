import type { ChatInputCommandInteraction } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { QueueStore } from "../src/core/queueStore.js";
import { handleChatInputCommand } from "../src/discord/interactionHandler.js";
import type { YoutubeSearchResult } from "../src/integrations/types.js";

const YOUTUBE_LINK = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const LINKED_VIDEO: YoutubeSearchResult = {
  title: "Exact linked video",
  videoId: "dQw4w9WgXcQ",
  url: YOUTUBE_LINK,
  channelTitle: "Exact Channel",
  sourceName: "YouTube"
};

function createVoicePlaybackStub(options: { hasSession?: boolean; isPlayerIdle?: boolean } = {}) {
  return {
    hasSession: vi.fn(() => options.hasSession ?? false),
    connect: vi.fn(async () => undefined),
    playCurrent: vi.fn(async () => true),
    isPlayerIdle: vi.fn(() => options.isPlayerIdle ?? true),
    isPlayerPaused: vi.fn(() => false),
    resume: vi.fn(),
    setVolume: vi.fn(),
    stopAndDisconnect: vi.fn(async () => undefined),
    handleVoiceStateUpdate: vi.fn(async () => undefined)
  };
}

function createInteraction(commandName: "play" | "playnext", input = YOUTUBE_LINK) {
  const voiceChannel = { id: "voice-1" };
  const guild = {
    id: "guild-1",
    members: {
      fetch: vi.fn(async () => ({
        voice: {
          channel: voiceChannel
        }
      }))
    }
  };

  return {
    channelId: "1234",
    commandName,
    guildId: "guild-1",
    guild,
    member: null,
    deferred: false,
    replied: false,
    user: { id: "user-1" },
    options: {
      getString: vi.fn(() => input)
    },
    reply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    deleteReply: vi.fn(async () => undefined)
  };
}

function createContext(
  queueStore: QueueStore,
  voicePlayback: ReturnType<typeof createVoicePlaybackStub>,
  searchTopVideo: (input: string) => Promise<YoutubeSearchResult | null>
) {
  return {
    controlChannelId: "1234",
    queueLimit: 50,
    watchTogetherApplicationId: "880218394199220334",
    queueStore,
    voicePlayback: voicePlayback as any,
    integrations: {
      gemini: { generateReply: vi.fn(async () => "unused") },
      youtube: {
        searchTopVideo,
        searchSuggestions: vi.fn(async () => [])
      }
    }
  };
}

describe("/play and /playnext links", () => {
  it("queues a pasted YouTube link with /play", async () => {
    const interaction = createInteraction("play");
    const queueStore = new QueueStore();
    const voicePlayback = createVoicePlaybackStub();
    const searchTopVideo = vi.fn(async () => LINKED_VIDEO);

    await handleChatInputCommand(
      interaction as unknown as ChatInputCommandInteraction,
      createContext(queueStore, voicePlayback, searchTopVideo)
    );

    expect(searchTopVideo).toHaveBeenCalledWith(YOUTUBE_LINK);
    expect(queueStore.getSnapshot("guild-1").current).toMatchObject({
      title: LINKED_VIDEO.title,
      url: YOUTUBE_LINK,
      channelTitle: LINKED_VIDEO.channelTitle
    });
    expect(voicePlayback.playCurrent).toHaveBeenCalledWith("guild-1", false);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("Source: YouTube audio (Exact Channel).")
    );
  });

  it("inserts a pasted YouTube link next with /playnext", async () => {
    const interaction = createInteraction("playnext");
    const queueStore = new QueueStore();
    const voicePlayback = createVoicePlaybackStub({
      hasSession: true,
      isPlayerIdle: false
    });
    const searchTopVideo = vi.fn(async () => LINKED_VIDEO);

    queueStore.enqueue(
      "guild-1",
      {
        title: "Song A",
        videoId: "a",
        url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
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
        url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
        channelTitle: "Channel"
      },
      "user-1",
      "end"
    );

    await handleChatInputCommand(
      interaction as unknown as ChatInputCommandInteraction,
      createContext(queueStore, voicePlayback, searchTopVideo)
    );

    const state = queueStore.getSnapshot("guild-1");
    expect(searchTopVideo).toHaveBeenCalledWith(YOUTUBE_LINK);
    expect(state.current?.title).toBe("Song A");
    expect(state.queue.map((track) => track.title)).toEqual([
      LINKED_VIDEO.title,
      "Song B"
    ]);
    expect(voicePlayback.playCurrent).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining(`Queued for next: **${LINKED_VIDEO.title}**`)
    );
  });

  it("queues a non-YouTube playable URL directly without searching YouTube", async () => {
    const directUrl = "https://cdn.example.com/audio/my-song.mp3";
    const interaction = createInteraction("play", directUrl);
    const queueStore = new QueueStore();
    const voicePlayback = createVoicePlaybackStub();
    const searchTopVideo = vi.fn(async () => null);

    await handleChatInputCommand(
      interaction as unknown as ChatInputCommandInteraction,
      createContext(queueStore, voicePlayback, searchTopVideo)
    );

    expect(searchTopVideo).not.toHaveBeenCalled();
    expect(queueStore.getSnapshot("guild-1").current).toMatchObject({
      title: "my song",
      url: directUrl,
      channelTitle: "cdn.example.com"
    });
    expect(voicePlayback.playCurrent).toHaveBeenCalledWith("guild-1", false);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("Source: Direct link audio (cdn.example.com).")
    );
  });
});
