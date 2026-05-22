import type { ChatInputCommandInteraction } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { QueueStore } from "../src/core/queueStore.js";
import { handleChatInputCommand } from "../src/discord/interactionHandler.js";
import type { SunoSong } from "../src/integrations/types.js";

const SUNO_SONG: SunoSong = {
  songId: "ab39a04d-b2e6-463b-9b8e-ddea725422f5",
  title: "Life's a Soundtrack",
  pageUrl: "https://suno.com/song/ab39a04d-b2e6-463b-9b8e-ddea725422f5",
  audioUrl: "https://cdn1.suno.ai/ab39a04d-b2e6-463b-9b8e-ddea725422f5.mp3",
  playbackUrl: "https://cdn1.suno.ai/ab39a04d-b2e6-463b-9b8e-ddea725422f5.mp3",
  url: "https://suno.com/song/ab39a04d-b2e6-463b-9b8e-ddea725422f5",
  channelTitle: "Suno",
  sourceName: "Suno"
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

function createInteraction(commandName = "suno") {
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
      getString: vi.fn(() => SUNO_SONG.pageUrl)
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
  resolveSong: (input: string) => Promise<SunoSong | null>
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
        searchTopVideo: vi.fn(async () => null),
        searchSuggestions: vi.fn(async () => [])
      },
      suno: {
        isSunoUrl: vi.fn(() => true),
        resolveSong
      }
    }
  };
}

describe("/suno command", () => {
  it("queues a public Suno song URL through the Suno integration", async () => {
    const interaction = createInteraction();
    const queueStore = new QueueStore();
    const voicePlayback = createVoicePlaybackStub();
    const resolveSong = vi.fn(async (_input: string) => SUNO_SONG);

    await handleChatInputCommand(
      interaction as unknown as ChatInputCommandInteraction,
      createContext(queueStore, voicePlayback, resolveSong)
    );

    expect(resolveSong).toHaveBeenCalledWith(SUNO_SONG.pageUrl);
    expect(voicePlayback.connect).toHaveBeenCalledTimes(1);
    expect(voicePlayback.playCurrent).toHaveBeenCalledWith("guild-1", false);
    expect(queueStore.getSnapshot("guild-1").current).toMatchObject({
      title: SUNO_SONG.title,
      url: SUNO_SONG.pageUrl,
      playbackUrl: SUNO_SONG.audioUrl,
      channelTitle: "Suno"
    });
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("Source: Suno audio.")
    );
  });

  it("adds Suno songs to the end of the queue when next is not specified", async () => {
    const interaction = createInteraction();
    const queueStore = new QueueStore();
    const voicePlayback = createVoicePlaybackStub({
      hasSession: true,
      isPlayerIdle: false
    });
    const resolveSong = vi.fn(async (_input: string) => SUNO_SONG);

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
      createContext(queueStore, voicePlayback, resolveSong)
    );

    const state = queueStore.getSnapshot("guild-1");
    expect(state.current?.title).toBe("Song A");
    expect(state.queue.map((track) => track.title)).toEqual([
      "Song B",
      SUNO_SONG.title
    ]);
    expect(voicePlayback.playCurrent).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining(`Added to queue: **${SUNO_SONG.title}**`)
    );
  });

  it("queues Suno songs to play next with /sunonext", async () => {
    const interaction = createInteraction("sunonext");
    const queueStore = new QueueStore();
    const voicePlayback = createVoicePlaybackStub({
      hasSession: true,
      isPlayerIdle: false
    });
    const resolveSong = vi.fn(async (_input: string) => SUNO_SONG);

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
      createContext(queueStore, voicePlayback, resolveSong)
    );

    const state = queueStore.getSnapshot("guild-1");
    expect(resolveSong).toHaveBeenCalledWith(SUNO_SONG.pageUrl);
    expect(state.current?.title).toBe("Song A");
    expect(state.queue.map((track) => track.title)).toEqual([
      SUNO_SONG.title,
      "Song B"
    ]);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining(`Queued for next: **${SUNO_SONG.title}**`)
    );
  });
});
