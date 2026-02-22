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
  guildId: string | null;
  deferred: boolean;
  replied: boolean;
  user: { id: string };
  options: {
    getString: ReturnType<typeof vi.fn>;
  };
  reply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
};

function createInteraction(): MockInteraction {
  return {
    channelId: "1234",
    commandName: "jibboo",
    guildId: "guild-1",
    deferred: false,
    replied: false,
    user: { id: "user-1" },
    options: {
      getString: vi.fn(() => "help me pick the next track")
    },
    reply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined)
  };
}

describe("/jibboo command", () => {
  it("calls Gemini and replies publicly", async () => {
    const interaction = createInteraction();
    const geminiSpy = vi.fn(async () => "Try adding some lo-fi next.");

    await handleChatInputCommand(
      interaction as unknown as ChatInputCommandInteraction,
      {
        controlChannelId: "1234",
        queueLimit: 50,
        watchTogetherApplicationId: "880218394199220334",
        queueStore: new QueueStore(),
        voicePlayback: createVoicePlaybackStub() as any,
        integrations: {
          gemini: { generateReply: geminiSpy },
          youtube: {
            searchTopVideo: vi.fn(async () => null),
            searchSuggestions: vi.fn(async () => [])
          }
        }
      }
    );

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(geminiSpy).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith("Try adding some lo-fi next.");
  });

  it("returns a clear error when Gemini call fails", async () => {
    const interaction = createInteraction();

    await handleChatInputCommand(
      interaction as unknown as ChatInputCommandInteraction,
      {
        controlChannelId: "1234",
        queueLimit: 50,
        watchTogetherApplicationId: "880218394199220334",
        queueStore: new QueueStore(),
        voicePlayback: createVoicePlaybackStub() as any,
        integrations: {
          gemini: {
            generateReply: vi.fn(async () => {
              throw new Error("bad key");
            })
          },
          youtube: {
            searchTopVideo: vi.fn(async () => null),
            searchSuggestions: vi.fn(async () => [])
          }
        }
      }
    );

    expect(interaction.editReply).toHaveBeenCalledWith(
      "Gemini request failed. Check GEMINI_API_KEY / GEMINI_MODEL configuration."
    );
  });
});
