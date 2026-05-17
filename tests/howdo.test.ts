import type { ChatInputCommandInteraction } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { QueueStore } from "../src/core/queueStore.js";
import { handleChatInputCommand } from "../src/discord/interactionHandler.js";

function createVoicePlaybackStub() {
  return {
    hasSession: vi.fn(() => false),
    connect: vi.fn(async () => undefined),
    playCurrent: vi.fn(async () => false),
    setVolume: vi.fn(),
    stopAndDisconnect: vi.fn(async () => undefined),
    handleVoiceStateUpdate: vi.fn(async () => undefined)
  };
}

type MockInteraction = {
  channelId: string;
  commandName: string;
  deferred: boolean;
  replied: boolean;
  reply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
};

function createInteraction(channelId: string): MockInteraction {
  return {
    channelId,
    commandName: "howdo",
    deferred: false,
    replied: false,
    reply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined)
  };
}

describe("/howdo command", () => {
  it("returns ephemeral help when used in the control channel", async () => {
    const controlChannelId = "1234";
    const interaction = createInteraction(controlChannelId);
    const queueStore = new QueueStore();

    await handleChatInputCommand(
      interaction as unknown as ChatInputCommandInteraction,
      {
        controlChannelId,
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
      }
    );

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).not.toHaveBeenCalled();

    const [payload] = interaction.reply.mock.calls[0] as [{
      content: string;
      ephemeral: boolean;
    }];

    expect(payload.ephemeral).toBe(true);
    expect(payload.content).toContain("`/play <text-or-url>`");
    expect(payload.content).toContain("`/video <text-or-url>`");
    expect(payload.content).toContain("`/playnext <input>`");
    expect(payload.content).toContain("`/playlist <artist-or-genre>`");
    expect(payload.content).toContain("`/remove <number>`");
    expect(payload.content).toContain("`/jibboo <instruction>`");
    expect(payload.content).toContain("Queue limit: 50 tracks.");
    expect(payload.content).toContain(`Run commands in <#${controlChannelId}>.`);
  });

  it("returns channel guidance when used outside the control channel", async () => {
    const controlChannelId = "1234";
    const interaction = createInteraction("5678");

    await handleChatInputCommand(
      interaction as unknown as ChatInputCommandInteraction,
      {
        controlChannelId,
        queueLimit: 50,
        watchTogetherApplicationId: "880218394199220334",
        queueStore: new QueueStore(),
        voicePlayback: createVoicePlaybackStub() as any,
        integrations: {
          gemini: { generateReply: vi.fn(async () => "unused") },
          youtube: {
            searchTopVideo: vi.fn(async () => null),
            searchSuggestions: vi.fn(async () => [])
          }
        }
      }
    );

    expect(interaction.reply).toHaveBeenCalledTimes(1);

    const [payload] = interaction.reply.mock.calls[0] as [{
      content: string;
      ephemeral: boolean;
    }];

    expect(payload.ephemeral).toBe(true);
    expect(payload.content).toBe(`Please run this command in <#${controlChannelId}>.`);
  });

  it("does not call integrations or mutate queue", async () => {
    const controlChannelId = "1234";
    const interaction = createInteraction(controlChannelId);
    const queueStore = new QueueStore();
    const geminiSpy = vi.fn(async () => "unused");
    const youtubeSpy = vi.fn(async () => null);

    const before = queueStore.getSnapshot("guild-1");

    await handleChatInputCommand(
      interaction as unknown as ChatInputCommandInteraction,
      {
        controlChannelId,
        queueLimit: 50,
        watchTogetherApplicationId: "880218394199220334",
        queueStore,
        voicePlayback: createVoicePlaybackStub() as any,
        integrations: {
          gemini: { generateReply: geminiSpy },
          youtube: {
            searchTopVideo: youtubeSpy,
            searchSuggestions: vi.fn(async () => [])
          }
        }
      }
    );

    const after = queueStore.getSnapshot("guild-1");

    expect(geminiSpy).not.toHaveBeenCalled();
    expect(youtubeSpy).not.toHaveBeenCalled();
    expect(after).toEqual(before);
  });
});
