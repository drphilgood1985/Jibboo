import { spawn, type ChildProcess } from "node:child_process";
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection,
  StreamType
} from "@discordjs/voice";
import type { Guild, VoiceBasedChannel } from "discord.js";
import type { QueueStore } from "./queueStore.js";

interface GuildVoiceSession {
  channelId: string;
  connection: VoiceConnection;
  player: AudioPlayer;
  ytdlpProcess: ChildProcess | null;
  ffmpegProcess: ChildProcess | null;
  ignoreNextIdle: boolean;
  noListenerTimeout: NodeJS.Timeout | null;
}

function normalizePlaybackUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host === "music.youtube.com" || host === "www.music.youtube.com") {
      const videoId = parsed.searchParams.get("v");
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }
  } catch {
    return url;
  }

  return url;
}

export class VoicePlaybackController {
  private readonly sessions = new Map<string, GuildVoiceSession>();

  constructor(
    private readonly queueStore: QueueStore,
    private readonly noListenerGraceSeconds: number,
    private readonly onPlaybackStateChange?: (guildId: string) => Promise<void> | void,
    private readonly ytdlpCookiesPath: string | null = null
  ) {}

  hasSession(guildId: string): boolean {
    return this.sessions.has(guildId);
  }

  getSessionChannelId(guildId: string): string | null {
    const session = this.sessions.get(guildId);
    return session?.channelId ?? null;
  }

  isPlayerIdle(guildId: string): boolean {
    const session = this.sessions.get(guildId);
    if (!session) {
      return true;
    }

    return session.player.state.status === AudioPlayerStatus.Idle;
  }

  isPlayerPaused(guildId: string): boolean {
    const session = this.sessions.get(guildId);
    if (!session) {
      return false;
    }

    return session.player.state.status === AudioPlayerStatus.Paused;
  }

  async connect(guild: Guild, voiceChannel: VoiceBasedChannel): Promise<void> {
    const existingSession = this.sessions.get(guild.id);
    if (existingSession && existingSession.channelId === voiceChannel.id) {
      return;
    }

    const player = existingSession?.player ?? createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play
      }
    });

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    connection.subscribe(player);

    if (existingSession) {
      this.clearNoListenerTimer(existingSession);
      this.stopTrackPipeline(existingSession);
      existingSession.connection.destroy();
    }

    const session: GuildVoiceSession = {
      channelId: voiceChannel.id,
      connection,
      player,
      ytdlpProcess: null,
      ffmpegProcess: null,
      ignoreNextIdle: false,
      noListenerTimeout: null
    };

    if (!existingSession) {
      this.bindPlayerEvents(guild.id, session);
    }

    this.sessions.set(guild.id, session);
  }

  async playCurrent(guildId: string, interruptCurrent: boolean): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session) {
      return false;
    }

    if (interruptCurrent && session.player.state.status !== AudioPlayerStatus.Idle) {
      session.ignoreNextIdle = true;
      session.player.stop(true);
    }

    const state = this.queueStore.getSnapshot(guildId);
    const currentTrack = state.current;

    if (!currentTrack) {
      this.stopTrackPipeline(session);

      // When /next interrupts into an empty queue, the next idle is ignored by design.
      // Trigger a state change explicitly so playlist autoplay can refill and resume.
      if (interruptCurrent) {
        try {
          await entersState(session.player, AudioPlayerStatus.Idle, 2_000);
        } catch {
          // Best-effort synchronization before notifying autoplay callbacks.
        }
      }

      this.notifyPlaybackStateChange(guildId);
      return false;
    }

    this.stopTrackPipeline(session);

    const playbackUrl = normalizePlaybackUrl(currentTrack.url);
    const ytdlpArgs = [
      "--no-playlist",
      ...(this.ytdlpCookiesPath
        ? ["--cookies", this.ytdlpCookiesPath]
        : []),
      "--format",
      "bestaudio[acodec!=none]/bestaudio/best[acodec!=none]/best",
      "--output",
      "-",
      playbackUrl
    ];

    const ytdlpProcess = spawn(
      "yt-dlp",
      ytdlpArgs,
      {
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    const ffmpegProcess = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-f",
        "s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        "pipe:1"
      ],
      {
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    if (!ytdlpProcess.stdout || !ffmpegProcess.stdin) {
      throw new Error("Failed to initialize yt-dlp/ffmpeg pipeline streams.");
    }

    ytdlpProcess.stdout.pipe(ffmpegProcess.stdin);

    ytdlpProcess.on("error", (error) => {
      console.error("yt-dlp process error:", error);
    });

    ytdlpProcess.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line.length > 0) {
        console.log(`[yt-dlp:${guildId}] ${line}`);
      }
    });

    ytdlpProcess.on("close", (code, signal) => {
      if (code !== 0) {
        console.error(`yt-dlp exited with code ${code}, signal ${signal ?? "none"}`);
      }
    });

    ffmpegProcess.on("error", (error) => {
      console.error("ffmpeg process error:", error);
    });

    ffmpegProcess.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line.length > 0) {
        console.log(`[ffmpeg:${guildId}] ${line}`);
      }
    });

    ffmpegProcess.on("close", (code, signal) => {
      if (code !== 0) {
        console.error(`ffmpeg exited with code ${code}, signal ${signal ?? "none"}`);
      }
    });

    session.ytdlpProcess = ytdlpProcess;
    session.ffmpegProcess = ffmpegProcess;

    if (!ffmpegProcess.stdout) {
      throw new Error("ffmpeg output stream not available.");
    }

    const resource = createAudioResource(ffmpegProcess.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true
    });

    resource.volume?.setVolume(Math.max(0, Math.min(1, state.volume / 100)));

    session.player.play(resource);
    await entersState(session.player, AudioPlayerStatus.Playing, 10_000);
    return true;
  }

  setVolume(guildId: string, volumePercent: number): void {
    const session = this.sessions.get(guildId);
    if (!session) {
      return;
    }

    const currentResource =
      session.player.state.status === AudioPlayerStatus.Playing
        ? session.player.state.resource
        : null;

    currentResource?.volume?.setVolume(Math.max(0, Math.min(1, volumePercent / 100)));
  }

  pause(guildId: string): boolean {
    const session = this.sessions.get(guildId);
    if (!session) {
      return false;
    }

    return session.player.pause();
  }

  resume(guildId: string): boolean {
    const session = this.sessions.get(guildId);
    if (!session) {
      return false;
    }

    return session.player.unpause();
  }

  async stopAndDisconnect(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);
    if (!session) {
      return;
    }

    session.ignoreNextIdle = true;
    session.player.stop(true);
    this.stopTrackPipeline(session);
    this.clearNoListenerTimer(session);
    session.connection.destroy();

    this.sessions.delete(guildId);
    this.notifyPlaybackStateChange(guildId);
  }

  async handleVoiceStateUpdate(guild: Guild): Promise<void> {
    const session = this.sessions.get(guild.id);
    if (!session) {
      return;
    }

    const channel = guild.channels.cache.get(session.channelId);
    if (!channel?.isVoiceBased()) {
      return;
    }

    const humanMembers = [...channel.members.values()].filter((member) => !member.user.bot).length;

    if (humanMembers > 0) {
      this.clearNoListenerTimer(session);
      return;
    }

    if (session.noListenerTimeout) {
      return;
    }

    session.noListenerTimeout = setTimeout(() => {
      void this.enforceNoListenerStop(guild, session.channelId);
    }, this.noListenerGraceSeconds * 1000);
  }

  private bindPlayerEvents(guildId: string, session: GuildVoiceSession): void {
    session.player.on(AudioPlayerStatus.Playing, () => {
      console.log(`Audio player is now playing for guild ${guildId}`);
      this.notifyPlaybackStateChange(guildId);
    });

    session.player.on(AudioPlayerStatus.Buffering, () => {
      console.log(`Audio player is buffering for guild ${guildId}`);
    });

    session.player.on(AudioPlayerStatus.Paused, () => {
      console.log(`Audio player is paused for guild ${guildId}`);
    });

    session.player.on(AudioPlayerStatus.Idle, () => {
      void this.handleIdle(guildId);
    });

    session.player.on("error", (error) => {
      console.error("Audio player error:", error);
      void this.handleIdle(guildId);
    });
  }

  private async handleIdle(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);
    if (!session) {
      return;
    }

    if (session.ignoreNextIdle) {
      session.ignoreNextIdle = false;
      return;
    }

    this.stopTrackPipeline(session);

    let nextState = this.queueStore.next(guildId);
    if (!nextState.current) {
      this.notifyPlaybackStateChange(guildId);
      return;
    }

    const maxAttempts = Math.max(1, nextState.queue.length + 1);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await this.playCurrent(guildId, false);
        return;
      } catch (error) {
        console.error("Failed to play queued track. Skipping to next:", error);
        this.stopTrackPipeline(session);

        nextState = this.queueStore.next(guildId);
        if (!nextState.current) {
          this.notifyPlaybackStateChange(guildId);
          return;
        }
      }
    }
  }

  private async enforceNoListenerStop(guild: Guild, channelId: string): Promise<void> {
    const session = this.sessions.get(guild.id);
    if (!session || session.channelId !== channelId) {
      return;
    }

    session.noListenerTimeout = null;

    const channel = guild.channels.cache.get(channelId);
    if (channel?.isVoiceBased()) {
      const humanMembers = [...channel.members.values()].filter((member) => !member.user.bot).length;
      if (humanMembers > 0) {
        return;
      }
    }

    await this.stopAndDisconnect(guild.id);
  }

  private stopTrackPipeline(session: GuildVoiceSession): void {
    if (session.ytdlpProcess) {
      session.ytdlpProcess.kill("SIGTERM");
      session.ytdlpProcess = null;
    }

    if (session.ffmpegProcess) {
      session.ffmpegProcess.kill("SIGTERM");
      session.ffmpegProcess = null;
    }
  }

  private clearNoListenerTimer(session: GuildVoiceSession): void {
    if (session.noListenerTimeout) {
      clearTimeout(session.noListenerTimeout);
      session.noListenerTimeout = null;
    }
  }

  private notifyPlaybackStateChange(guildId: string): void {
    if (!this.onPlaybackStateChange) {
      return;
    }

    Promise.resolve(this.onPlaybackStateChange(guildId)).catch((error) => {
      console.error("Playback state callback failed:", error);
    });
  }
}
