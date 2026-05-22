import type { QueueableMedia } from "../integrations/types.js";

export interface Track {
  id: string;
  title: string;
  url: string;
  playbackUrl?: string;
  channelTitle: string;
  requestedByUserId: string;
}

export interface GuildQueueState {
  current: Track | null;
  queue: Track[];
  history: Track[];
  volume: number;
}

export interface EnqueueResult {
  state: GuildQueueState;
  added: Track;
  startedPlaying: boolean;
}

export interface RemoveQueuedTrackResult {
  state: GuildQueueState;
  removed: Track | null;
}

export interface ClearQueueResult {
  state: GuildQueueState;
  cleared: number;
}

export interface ClearPlaybackResult {
  state: GuildQueueState;
  cleared: number;
}

export class QueueStore {
  private states = new Map<string, GuildQueueState>();

  private nextTrackOrdinal = 1;

  getSnapshot(guildId: string): GuildQueueState {
    const state = this.ensureState(guildId);
    return {
      current: state.current,
      queue: [...state.queue],
      history: [...state.history],
      volume: state.volume
    };
  }

  enqueue(
    guildId: string,
    media: QueueableMedia,
    requestedByUserId: string,
    mode: "end" | "next"
  ): EnqueueResult {
    const state = this.ensureState(guildId);

    const track: Track = {
      id: String(this.nextTrackOrdinal++),
      title: media.title,
      url: media.url,
      channelTitle: media.channelTitle,
      requestedByUserId
    };
    if (media.playbackUrl) {
      track.playbackUrl = media.playbackUrl;
    }

    let startedPlaying = false;

    if (!state.current) {
      state.current = track;
      startedPlaying = true;
    } else if (mode === "next") {
      state.queue.unshift(track);
    } else {
      state.queue.push(track);
    }

    return {
      state: this.getSnapshot(guildId),
      added: track,
      startedPlaying
    };
  }

  next(guildId: string): GuildQueueState {
    const state = this.ensureState(guildId);

    if (state.current) {
      state.history.push(state.current);
    }

    state.current = state.queue.shift() ?? null;
    return this.getSnapshot(guildId);
  }

  previous(guildId: string): GuildQueueState {
    const state = this.ensureState(guildId);
    const previousTrack = state.history.pop();

    if (!previousTrack) {
      return this.getSnapshot(guildId);
    }

    if (state.current) {
      state.queue.unshift(state.current);
    }

    state.current = previousTrack;
    return this.getSnapshot(guildId);
  }

  removeQueuedTrackAt(guildId: string, position: number): RemoveQueuedTrackResult {
    const state = this.ensureState(guildId);
    const index = Math.trunc(position) - 1;

    if (index < 0 || index >= state.queue.length) {
      return {
        state: this.getSnapshot(guildId),
        removed: null
      };
    }

    const [removed] = state.queue.splice(index, 1);
    return {
      state: this.getSnapshot(guildId),
      removed: removed ?? null
    };
  }

  clearQueue(guildId: string): ClearQueueResult {
    const state = this.ensureState(guildId);
    const cleared = state.queue.length;
    state.queue = [];

    return {
      state: this.getSnapshot(guildId),
      cleared
    };
  }

  clearPlayback(guildId: string): ClearPlaybackResult {
    const state = this.ensureState(guildId);
    const cleared = (state.current ? 1 : 0) + state.queue.length;

    state.current = null;
    state.queue = [];
    state.history = [];

    return {
      state: this.getSnapshot(guildId),
      cleared
    };
  }

  setVolume(guildId: string, volume: number): GuildQueueState {
    const state = this.ensureState(guildId);
    state.volume = Math.max(0, Math.min(100, volume));
    return this.getSnapshot(guildId);
  }

  private ensureState(guildId: string): GuildQueueState {
    const existing = this.states.get(guildId);
    if (existing) {
      return existing;
    }

    const initial: GuildQueueState = {
      current: null,
      queue: [],
      history: [],
      volume: 20
    };

    this.states.set(guildId, initial);
    return initial;
  }
}

export function formatNowPlaying(state: GuildQueueState): string {
  if (!state.current) {
    return "Nothing is currently queued/playing.";
  }

  return `Now playing: **${state.current.title}**`;
}

export function formatQueuePreview(state: GuildQueueState, maxItems = 5): string {
  if (state.queue.length === 0) {
    return "Queue: empty";
  }

  const preview = state.queue
    .slice(0, maxItems)
    .map((track, index) => `${index + 1}. ${track.title}`)
    .join("\n");

  const suffix =
    state.queue.length > maxItems ? `\n...and ${state.queue.length - maxItems} more.` : "";

  return `Queue:\n${preview}${suffix}`;
}
