export interface GeminiService {
  generateReply: (instruction: string) => Promise<string>;
}

export interface YoutubeSearchResult {
  title: string;
  videoId: string;
  url: string;
  channelTitle: string;
  thumbnailUrl?: string;
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

export interface IntegrationClients {
  gemini: GeminiService;
  youtube: YoutubeService;
}
