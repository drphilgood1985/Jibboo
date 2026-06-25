export interface GeminiService {
  generateReply: (instruction: string) => Promise<string>;
}

export interface QueueableMedia {
  title: string;
  videoId?: string;
  url: string;
  playbackUrl?: string;
  channelTitle: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  sourceName?: string;
}

export interface YoutubeSearchResult extends QueueableMedia {
  videoId: string;
}

export interface YoutubeLookupOptions {
  allowFallback?: boolean;
  allowUnrequestedVariants?: boolean;
  expectedArtistName?: string | null;
  expectedTitle?: string | null;
  preferOfficialAudio?: boolean;
}

export interface YoutubeService {
  searchTopVideo: (
    query: string,
    mode?: "music" | "video",
    options?: YoutubeLookupOptions
  ) => Promise<YoutubeSearchResult | null>;
  searchSuggestions: (
    query: string,
    limit: number,
    mode?: "music" | "video",
    options?: YoutubeLookupOptions
  ) => Promise<YoutubeSearchResult[]>;
  searchRelatedSuggestions?: (
    videoId: string,
    limit: number,
    mode?: "music" | "video",
    options?: YoutubeLookupOptions
  ) => Promise<YoutubeSearchResult[]>;
}

export interface SunoSong extends QueueableMedia {
  songId: string;
  pageUrl: string;
  audioUrl: string;
  playbackUrl: string;
  sourceName: "Suno";
}

export interface SunoService {
  isSunoUrl: (input: string) => boolean;
  resolveSong: (input: string) => Promise<SunoSong | null>;
}

export interface SpotifyTrack {
  trackId: string;
  title: string;
  artistName: string | null;
  pageUrl: string;
  searchQuery: string;
  thumbnailUrl?: string;
}

export interface SpotifyService {
  isSpotifyUrl: (input: string) => boolean;
  resolveTrack: (input: string) => Promise<SpotifyTrack | null>;
}

export interface IntegrationClients {
  gemini: GeminiService;
  youtube: YoutubeService;
  suno?: SunoService;
  spotify?: SpotifyService;
}
