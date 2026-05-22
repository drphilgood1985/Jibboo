export interface GeminiService {
  generateReply: (instruction: string) => Promise<string>;
}

export interface QueueableMedia {
  title: string;
  videoId?: string;
  url: string;
  playbackUrl?: string;
  channelTitle: string;
  thumbnailUrl?: string;
  sourceName?: string;
}

export interface YoutubeSearchResult extends QueueableMedia {
  videoId: string;
}

export interface YoutubeService {
  searchTopVideo: (
    query: string,
    mode?: "music" | "video"
  ) => Promise<YoutubeSearchResult | null>;
  searchSuggestions: (
    query: string,
    limit: number,
    mode?: "music" | "video"
  ) => Promise<YoutubeSearchResult[]>;
  searchRelatedSuggestions?: (
    videoId: string,
    limit: number,
    mode?: "music" | "video"
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

export interface IntegrationClients {
  gemini: GeminiService;
  youtube: YoutubeService;
  suno?: SunoService;
}
