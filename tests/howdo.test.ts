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
  user: {
    send: ReturnType<typeof vi.fn>;
  };
  reply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  deleteReply: ReturnType<typeof vi.fn>;
};

function createInteraction(channelId: string): MockInteraction {
  return {
    channelId,
    commandName: "howdo",
    deferred: false,
    replied: false,
    user: {
      send: vi.fn(async () => undefined)
    },
    reply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    deleteReply: vi.fn(async () => undefined)
  };
}

describe("/howdo command", () => {
  it("DMs help when used in the control channel", async () => {
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

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.deleteReply).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();

    const [message] = interaction.user.send.mock.calls[0] as [string];

    expect(message).toContain("`/play <text-or-url>`");
    expect(message).toContain("`/video <text-or-url>`");
    expect(message).toContain("`/playnext <text-or-url>`");
    expect(message).toContain("`/suno <url>`");
    expect(message).toContain("`/sunonext <url>`");
    expect(message).toContain("`/playlist <artist-or-genre>`");
    expect(message).toContain("`/stop`");
    expect(message).toContain("accept song text or exact YouTube links");
    expect(message).toContain("stops playback, disconnects, clears the active queue");
    expect(message).toContain("/stop can be used from the command channel without joining voice.");
    expect(message).toContain("`/remove <number>`");
    expect(message).toContain("Queue #1 is the next song.");
    expect(message).toContain("`/jibboo <instruction>`");
    expect(message).toContain("Queue limit: 50 tracks.");
    expect(message).toContain(`Run commands in <#${controlChannelId}>.`);
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
    expect(interaction.user.send).not.toHaveBeenCalled();
  });

  it("returns an ephemeral failure when DMs are blocked", async () => {
    const controlChannelId = "1234";
    const interaction = createInteraction(controlChannelId);
    interaction.user.send = vi.fn(async () => {
      throw new Error("cannot dm");
    });

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

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.deleteReply).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      "I couldn't DM you instructions. Check your Discord privacy settings and try `/howdo` again."
    );
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
