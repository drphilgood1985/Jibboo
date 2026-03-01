import type { Guild } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { AutoplayController, isPlaylistStopInput } from "../src/core/autoplayController.js";
import { QueueStore } from "../src/core/queueStore.js";

function createGuildWithListeners(hasHumanListeners: boolean): Guild {
  const members = new Map([
    [
      hasHumanListeners ? "human-1" : "bot-1",
      {
        user: { bot: !hasHumanListeners }
      }
    ]
  ]);

  const voiceChannel = {
    isVoiceBased: () => true,
    members
  };

  return {
    id: "guild-1",
    channels: {
      cache: new Map([["voice-1", voiceChannel]])
    }
  } as unknown as Guild;
}

describe("AutoplayController", () => {
  it("recognizes stop keywords for /playlist", () => {
    expect(isPlaylistStopInput("off")).toBe(true);
    expect(isPlaylistStopInput("STOP")).toBe(true);
    expect(isPlaylistStopInput("disable")).toBe(true);
    expect(isPlaylistStopInput("synthwave")).toBe(false);
  });

  it("refills queue and starts playback when idle", async () => {
    const queueStore = new QueueStore();
    const youtubeService = {
      searchTopVideo: vi.fn(async () => null),
      searchSuggestions: vi.fn(async () => [
        {
          title: "Gunship - Tech Noir",
          videoId: "video-1",
          url: "https://music.youtube.com/watch?v=video-1",
          channelTitle: "GUNSHIPMUSIC"
        },
        {
          title: "The Midnight - Sunset",
          videoId: "video-2",
          url: "https://music.youtube.com/watch?v=video-2",
          channelTitle: "The Midnight"
        }
      ]),
      searchRelatedSuggestions: vi.fn(async () => [])
    };

    const voicePlayback = {
      hasSession: vi.fn(() => true),
      getSessionChannelId: vi.fn(() => "voice-1"),
      isPlayerIdle: vi.fn(() => true),
      playCurrent: vi.fn(async () => true)
    };

    const autoplay = new AutoplayController(
      queueStore,
      youtubeService as any,
      50
    );
    autoplay.enable("guild-1", "synthwave", "user-1");

    const result = await autoplay.refillForGuild(
      createGuildWithListeners(true),
      voicePlayback as any
    );

    const state = queueStore.getSnapshot("guild-1");
    expect(result.added).toBeGreaterThan(0);
    expect(state.current).not.toBeNull();
    expect(voicePlayback.playCurrent).toHaveBeenCalledTimes(1);
  });

  it("disables autoplay when no human listeners remain", async () => {
    const queueStore = new QueueStore();
    const youtubeService = {
      searchTopVideo: vi.fn(async () => null),
      searchSuggestions: vi.fn(async () => []),
      searchRelatedSuggestions: vi.fn(async () => [])
    };

    const voicePlayback = {
      hasSession: vi.fn(() => true),
      getSessionChannelId: vi.fn(() => "voice-1"),
      isPlayerIdle: vi.fn(() => true),
      playCurrent: vi.fn(async () => true)
    };

    const autoplay = new AutoplayController(
      queueStore,
      youtubeService as any,
      50
    );
    autoplay.enable("guild-1", "sublime", "user-1");

    await autoplay.refillForGuild(
      createGuildWithListeners(false),
      voicePlayback as any
    );

    expect(autoplay.isEnabled("guild-1")).toBe(false);
    expect(voicePlayback.playCurrent).not.toHaveBeenCalled();
  });
});
