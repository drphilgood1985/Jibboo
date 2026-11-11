import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { AudioPlayerStatus, type VoiceConnection } from "@discordjs/voice";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

class MockVoiceConnection extends EventEmitter {
  subscribe = vi.fn();
  destroy = vi.fn();
}

class MockChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stdin = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn((_signal?: NodeJS.Signals) => true);
}

const createdPlayers: MockAudioPlayer[] = [];
const createdConnections: MockVoiceConnection[] = [];
const createdProcesses: MockChildProcess[] = [];

vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn(() => {
      const process = new MockChildProcess();
      createdProcesses.push(process);
      return process;
    })
  };
});

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
    joinVoiceChannel: vi.fn(() => {
      const connection = new MockVoiceConnection();
      createdConnections.push(connection);
      return connection as unknown as VoiceConnection;
    }),
    entersState: vi.fn(async (target: unknown) => target),
    createAudioResource: vi.fn(() => ({
      volume: {
        setVolume: vi.fn()
      }
    }))
  };
});

describe("VoicePlaybackController", () => {
  beforeEach(() => {
    createdPlayers.length = 0;
    createdConnections.length = 0;
    createdProcesses.length = 0;
    vi.clearAllMocks();
  });

  it("lets ffmpeg seek Suno video URLs directly to read the audio index", () => {
    const controller = new VoicePlaybackController(new QueueStore(), 30);
    const url = "https://cdn1.suno.ai/f64e23e8-e32d-4852-a76d-2fd52be24110.mp4";
    const { pipeline } = (controller as any).createTrackResource("guild-1", url, 30);
    expect(pipeline.ytdlpProcess).toBeNull();
    expect(spawn).toHaveBeenCalledTimes(1);
    const args = vi.mocked(spawn).mock.calls[0]![1] as string[];
    expect(args[args.indexOf("-i") + 1]).toBe(url);
    expect(args).toContain("0:a:0");
  });

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

  it("logs voice connection errors instead of leaving them unhandled", async () => {
    const queueStore = new QueueStore();
    const controller = new VoicePlaybackController(queueStore, 30);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const guild = {
      id: "guild-1",
      voiceAdapterCreator: {}
    } as any;

    const voiceChannel = {
      id: "voice-1"
    } as any;

    await controller.connect(guild, voiceChannel);

    const connection = createdConnections[0];
    if (!connection) {
      throw new Error("Expected a voice connection instance to be created");
    }

    const error = Object.assign(new Error("getaddrinfo EAI_AGAIN discord.media"), {
      code: "EAI_AGAIN"
    });

    expect(() => {
      connection.emit("error", error);
    }).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith("Voice connection error for guild guild-1:", error);

    consoleError.mockRestore();
  });

  it("keeps advancing after manually skipping to the next track", async () => {
    const queueStore = new QueueStore();
    const guildId = "guild-1";
    const controller = new VoicePlaybackController(queueStore, 30);

    const tracks = [
      { title: "Song A", videoId: "a" },
      { title: "Song B", videoId: "b" },
      { title: "Song C", videoId: "c" }
    ];

    for (const track of tracks) {
      queueStore.enqueue(
        guildId,
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

    const guild = {
      id: guildId,
      voiceAdapterCreator: {}
    } as any;

    const voiceChannel = {
      id: "voice-1"
    } as any;

    await controller.connect(guild, voiceChannel);
    await controller.playCurrent(guildId, false);

    const player = createdPlayers[0];
    if (!player) {
      throw new Error("Expected an audio player instance to be created");
    }

    const initialProcesses = createdProcesses.slice();
    const state = await controller.skipToNext(guildId);

    expect(state.current?.title).toBe("Song B");
    expect(player.stop).not.toHaveBeenCalled();
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(initialProcesses).toHaveLength(2);
    expect(initialProcesses.every((process) => process.kill.mock.calls[0]?.[0] === "SIGTERM")).toBe(
      true
    );
    const oldFfmpegProcess = initialProcesses[1];
    if (!oldFfmpegProcess) {
      throw new Error("Expected the original ffmpeg process to exist");
    }
    expect(() => {
      oldFfmpegProcess.stdin.emit(
        "error",
        Object.assign(new Error("write EPIPE"), { code: "EPIPE" })
      );
    }).not.toThrow();

    player.state = {
      status: AudioPlayerStatus.Idle
    };
    player.emit(AudioPlayerStatus.Idle);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    const finalState = queueStore.getSnapshot(guildId);
    expect(finalState.current?.title).toBe("Song C");
    expect(player.play).toHaveBeenCalledTimes(3);
  });

  it("awaits playback refill when a manual skip empties the queue", async () => {
    const queueStore = new QueueStore();
    const guildId = "guild-1";
    let controller: VoicePlaybackController;

    const onPlaybackStateChange = vi.fn(async (changedGuildId: string) => {
      const snapshot = queueStore.getSnapshot(changedGuildId);
      if (snapshot.current || snapshot.queue.length > 0) {
        return;
      }

      queueStore.enqueue(
        changedGuildId,
        {
          title: "Song B",
          videoId: "b",
          url: "https://www.youtube.com/watch?v=b",
          channelTitle: "Channel"
        },
        "user-1",
        "end"
      );
      await controller.playCurrent(changedGuildId, false);
    });

    controller = new VoicePlaybackController(queueStore, 30, onPlaybackStateChange);
    queueStore.enqueue(
      guildId,
      {
        title: "Song A",
        videoId: "a",
        url: "https://www.youtube.com/watch?v=a",
        channelTitle: "Channel"
      },
      "user-1",
      "end"
    );

    const guild = {
      id: guildId,
      voiceAdapterCreator: {}
    } as any;

    const voiceChannel = {
      id: "voice-1"
    } as any;

    await controller.connect(guild, voiceChannel);
    await controller.playCurrent(guildId, false);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    const player = createdPlayers[0];
    if (!player) {
      throw new Error("Expected an audio player instance to be created");
    }

    const state = await controller.skipToNext(guildId);

    expect(state.current?.title).toBe("Song B");
    expect(player.play).toHaveBeenCalledTimes(2);
  });
});
