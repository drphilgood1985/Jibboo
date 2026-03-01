import type { Guild } from "discord.js";
import type { YoutubeSearchResult, YoutubeService } from "../integrations/types.js";
import type { QueueStore, Track } from "./queueStore.js";
import type { VoicePlaybackController } from "./voicePlayback.js";

interface PlaylistSession {
  query: string;
  requestedByUserId: string;
}

interface RefillResult {
  added: number;
  startedPlayback: boolean;
}

const TARGET_TRACK_DEPTH = 3;
const SEARCH_LIMIT = 10;
const MAX_HISTORY_TRACKS = 40;
const STOP_KEYWORDS = new Set(["off", "stop", "disable", "none"]);

function normalizeIdentityPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractVideoIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host === "youtu.be" || host === "www.youtu.be") {
      const id = parsed.pathname.replace("/", "").trim();
      return id.length > 0 ? id : null;
    }

    if (host.endsWith("youtube.com")) {
      const videoId = parsed.searchParams.get("v");
      if (videoId) {
        return videoId;
      }

      const shortsMatch = parsed.pathname.match(/\/shorts\/([A-Za-z0-9_-]+)/);
      if (shortsMatch?.[1]) {
        return shortsMatch[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

function toResultIdentity(result: YoutubeSearchResult): string {
  if (result.videoId && result.videoId.length > 0) {
    return `id:${result.videoId}`;
  }

  return `meta:${normalizeIdentityPart(result.title)}:${normalizeIdentityPart(result.channelTitle)}`;
}

function toTrackIdentity(track: Track): string {
  const videoId = extractVideoIdFromUrl(track.url);
  if (videoId) {
    return `id:${videoId}`;
  }

  return `meta:${normalizeIdentityPart(track.title)}:${normalizeIdentityPart(track.channelTitle)}`;
}

export function isPlaylistStopInput(input: string): boolean {
  return STOP_KEYWORDS.has(input.trim().toLowerCase());
}

export class AutoplayController {
  private readonly sessions = new Map<string, PlaylistSession>();

  private readonly refillsInProgress = new Set<string>();

  constructor(
    private readonly queueStore: QueueStore,
    private readonly youtubeService: YoutubeService,
    private readonly queueLimit: number
  ) {}

  enable(guildId: string, query: string, requestedByUserId: string): PlaylistSession {
    const normalizedQuery = query.replace(/\s+/g, " ").trim();
    const session: PlaylistSession = {
      query: normalizedQuery,
      requestedByUserId
    };
    this.sessions.set(guildId, session);
    return session;
  }

  disable(guildId: string): boolean {
    return this.sessions.delete(guildId);
  }

  isEnabled(guildId: string): boolean {
    return this.sessions.has(guildId);
  }

  getSession(guildId: string): PlaylistSession | null {
    return this.sessions.get(guildId) ?? null;
  }

  async handlePlaybackStateChange(
    guild: Guild,
    voicePlayback: VoicePlaybackController
  ): Promise<void> {
    if (!this.isEnabled(guild.id)) {
      return;
    }

    await this.refillForGuild(guild, voicePlayback);
  }

  async refillForGuild(guild: Guild, voicePlayback: VoicePlaybackController): Promise<RefillResult> {
    const guildId = guild.id;
    if (this.refillsInProgress.has(guildId)) {
      return { added: 0, startedPlayback: false };
    }

    const session = this.sessions.get(guildId);
    if (!session) {
      return { added: 0, startedPlayback: false };
    }

    this.refillsInProgress.add(guildId);
    try {
      if (!voicePlayback.hasSession(guildId)) {
        this.disable(guildId);
        return { added: 0, startedPlayback: false };
      }

      const channelId = voicePlayback.getSessionChannelId(guildId);
      if (!channelId) {
        this.disable(guildId);
        return { added: 0, startedPlayback: false };
      }

      const channel = guild.channels.cache.get(channelId);
      if (!channel?.isVoiceBased()) {
        this.disable(guildId);
        return { added: 0, startedPlayback: false };
      }

      const humanListeners = [...channel.members.values()].filter((member) => !member.user.bot).length;
      if (humanListeners === 0) {
        this.disable(guildId);
        return { added: 0, startedPlayback: false };
      }

      const snapshot = this.queueStore.getSnapshot(guildId);
      const totalTracks = (snapshot.current ? 1 : 0) + snapshot.queue.length;
      const desiredTotal = Math.max(1, Math.min(TARGET_TRACK_DEPTH, this.queueLimit));
      const needed = desiredTotal - totalTracks;

      if (needed <= 0) {
        return { added: 0, startedPlayback: false };
      }

      const blockedIdentities = new Set<string>();
      if (snapshot.current) {
        blockedIdentities.add(toTrackIdentity(snapshot.current));
      }

      for (const queuedTrack of snapshot.queue) {
        blockedIdentities.add(toTrackIdentity(queuedTrack));
      }

      for (const recentTrack of snapshot.history.slice(-MAX_HISTORY_TRACKS)) {
        blockedIdentities.add(toTrackIdentity(recentTrack));
      }

      const candidates = await this.findCandidates(session.query, snapshot.current?.url ?? null);
      let added = 0;

      for (const candidate of candidates) {
        if (added >= needed) {
          break;
        }

        const identity = toResultIdentity(candidate);
        if (blockedIdentities.has(identity)) {
          continue;
        }

        this.queueStore.enqueue(guildId, candidate, session.requestedByUserId, "end");
        blockedIdentities.add(identity);
        added += 1;
      }

      if (added === 0) {
        return { added: 0, startedPlayback: false };
      }

      let startedPlayback = false;
      if (voicePlayback.hasSession(guildId) && voicePlayback.isPlayerIdle(guildId)) {
        try {
          startedPlayback = await voicePlayback.playCurrent(guildId, false);
        } catch (error) {
          console.error("Autoplay failed to start queued track:", error);
        }
      }

      return { added, startedPlayback };
    } finally {
      this.refillsInProgress.delete(guildId);
    }
  }

  private async findCandidates(
    query: string,
    currentTrackUrl: string | null
  ): Promise<YoutubeSearchResult[]> {
    const batches: YoutubeSearchResult[][] = [];
    const currentVideoId = currentTrackUrl ? extractVideoIdFromUrl(currentTrackUrl) : null;

    if (currentVideoId && this.youtubeService.searchRelatedSuggestions) {
      try {
        const related = await this.youtubeService.searchRelatedSuggestions(
          currentVideoId,
          SEARCH_LIMIT,
          "music"
        );
        if (related.length > 0) {
          batches.push(related);
        }
      } catch (error) {
        console.error("Autoplay related suggestions lookup failed:", error);
      }
    }

    const searchQueries = [query, `${query} mix`, `${query} radio`];

    for (const searchQuery of searchQueries) {
      try {
        const suggestions = await this.youtubeService.searchSuggestions(
          searchQuery,
          SEARCH_LIMIT,
          "music"
        );
        if (suggestions.length > 0) {
          batches.push(suggestions);
        }
      } catch (error) {
        console.error(`Autoplay suggestions lookup failed for "${searchQuery}":`, error);
      }
    }

    const deduped = new Map<string, YoutubeSearchResult>();
    for (const batch of batches) {
      for (const result of batch) {
        const identity = toResultIdentity(result);
        if (!deduped.has(identity)) {
          deduped.set(identity, result);
        }
      }
    }

    if (deduped.size > 0) {
      return [...deduped.values()];
    }

    try {
      const topResult = await this.youtubeService.searchTopVideo(query, "music");
      return topResult ? [topResult] : [];
    } catch (error) {
      console.error("Autoplay top-track fallback failed:", error);
      return [];
    }
  }
}
