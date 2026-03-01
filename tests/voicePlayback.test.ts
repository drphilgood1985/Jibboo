import { EventEmitter } from "node:events";
import { AudioPlayerStatus, type VoiceConnection } from "@discordjs/voice";
import { describe, expect, it, vi } from "vitest";
import { QueueStore } from "../src/core/queueStore.js";
import { VoicePlaybackController } from "../src/core/voicePlayback.js";

class MockAudioPlayer extends EventEmitter {
  state = {
    status: AudioPlayerStatus.Idle
  };

  play = vi.fn((_resource: unknown) => {
    this.state = {
      status: AudioPlayerStatus.Playing
    };
    this.emit(AudioPlayerStatus.Playing);
  });

  stop = vi.fn((_force?: boolean) => {
    this.state = {
      status: AudioPlayerStatus.Idle
    };
    this.emit(AudioPlayerStatus.Idle);
    return true;
  });

  pause = vi.fn(() => true);
  unpause = vi.fn(() => true);
}

class MockVoiceConnection {
  subscribe = vi.fn();
  destroy = vi.fn();
}

const createdPlayers: MockAudioPlayer[] = [];

vi.mock("@discordjs/voice", async () => {
  const actual = await vi.importActual<typeof import("@discordjs/voice")>("@discordjs/voice");

  return {
    ...actual,
    AudioPlayerStatus: {
      Idle: "idle",
      Playing: "playing",
      Buffering: "buffering",
      Paused: "paused"
    },
    VoiceConnectionStatus: {
      Ready: "ready"
    },
    NoSubscriberBehavior: {
      Play: "play"
    },
    StreamType: {
      Raw: "raw"
    },
    createAudioPlayer: vi.fn(() => {
      const player = new MockAudioPlayer();
      createdPlayers.push(player);
      return player;
    }),
    joinVoiceChannel: vi.fn(() => new MockVoiceConnection() as unknown as VoiceConnection),
    entersState: vi.fn(async (target: unknown) => target),
    createAudioResource: vi.fn(() => ({
      volume: {
        setVolume: vi.fn()
      }
    }))
  };
});

describe("VoicePlaybackController", () => {
  it("notifies playback state when interrupting into an empty queue", async () => {
    const queueStore = new QueueStore();
    const onPlaybackStateChange = vi.fn(async () => undefined);
    const controller = new VoicePlaybackController(queueStore, 30, onPlaybackStateChange);

    const guild = {
      id: "guild-1",
      voiceAdapterCreator: {}
    } as any;

    const voiceChannel = {
      id: "voice-1"
    } as any;

    await controller.connect(guild, voiceChannel);

    const player = createdPlayers[0];
    if (!player) {
      throw new Error("Expected an audio player instance to be created");
    }

    player.state = {
      status: AudioPlayerStatus.Playing
    };

    const started = await controller.playCurrent(guild.id, true);

    expect(started).toBe(false);
    expect(player.stop).toHaveBeenCalledTimes(1);
    expect(onPlaybackStateChange).toHaveBeenCalledWith(guild.id);
  });
});
