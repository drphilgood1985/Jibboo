import { spawn } from "node:child_process";
import type { YoutubeSearchResult, YoutubeService } from "./types.js";

type SearchMode = "music" | "video";

export interface YoutubeServiceOptions {
  apiKey: string;
  ytdlpCookiesPath?: string | null;
}

interface YoutubeSearchItem {
  id?: {
    videoId?: string;
  };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
}

interface YoutubeSearchResponse {
  items?: YoutubeSearchItem[];
  error?: {
    message?: string;
  };
}

interface YtdlpSearchResult {
  id?: string;
  title?: string;
  webpage_url?: string;
  channel?: string;
  uploader?: string;
  thumbnail?: string;
}

interface YtdlpSearchCollection {
  entries?: YtdlpSearchResult[];
}

const QUOTA_BACKOFF_MS = 15 * 60 * 1000;

function toDisplayUrl(videoId: string, mode: SearchMode): string {
  if (mode === "music") {
    return `https://music.youtube.com/watch?v=${videoId}`;
  }

  return `https://www.youtube.com/watch?v=${videoId}`;
}

function toYoutubeResult(
  entry: YtdlpSearchResult,
  mode: SearchMode
): YoutubeSearchResult | null {
  if (!entry.id || !entry.title) {
    return null;
  }

  const result: YoutubeSearchResult = {
    title: entry.title,
    videoId: entry.id,
    url: mode === "music" ? toDisplayUrl(entry.id, mode) : entry.webpage_url ?? toDisplayUrl(entry.id, mode),
    channelTitle: entry.channel ?? entry.uploader ?? "Unknown channel"
  };

  if (entry.thumbnail) {
    result.thumbnailUrl = entry.thumbnail;
  }

  return result;
}

function toYtdlpQuery(mode: SearchMode, query: string): string {
  const normalized = query.replace(/\s+/g, " ").trim();

  if (mode === "music") {
    // Bias fallback results toward track uploads while using a widely supported search prefix.
    return `${normalized} official audio`;
  }

  return normalized;
}

function ytdlpSearchTerm(mode: SearchMode, query: string, limit: number): string {
  return `ytsearch${limit}:${toYtdlpQuery(mode, query)}`;
}

function isYoutubeQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes("quota");
}

function withCookiesArgs(args: string[], cookiesPath: string | null): string[] {
  if (!cookiesPath) {
    return args;
  }

  return ["--cookies", cookiesPath, ...args];
}

function runYtdlpSuggestions(
  query: string,
  limit: number,
  mode: SearchMode,
  cookiesPath: string | null
): Promise<YoutubeSearchResult[]> {
  return new Promise((resolve, reject) => {
    const process = spawn(
      "yt-dlp",
      withCookiesArgs(
        ["--dump-single-json", "--no-playlist", ytdlpSearchTerm(mode, query, limit)],
        cookiesPath
      ),
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";

    process.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    process.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    process.on("error", (error) => {
      reject(error);
    });

    process.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp search failed with code ${code}: ${stderr.trim()}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as YtdlpSearchCollection;
        const results = (parsed.entries ?? [])
          .map((entry) => toYoutubeResult(entry, mode))
          .filter((entry): entry is YoutubeSearchResult => Boolean(entry));

        resolve(results);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function runYtdlpMixRequest(
  mixUrl: string,
  limit: number,
  mode: SearchMode,
  cookiesPath: string | null
): Promise<YoutubeSearchResult[]> {
  return new Promise((resolve, reject) => {
    const process = spawn(
      "yt-dlp",
      withCookiesArgs(
        [
          "--flat-playlist",
          "--dump-single-json",
          "--playlist-end",
          String(Math.max(2, Math.min(50, limit + 1))),
          mixUrl
        ],
        cookiesPath
      ),
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";

    process.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    process.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    process.on("error", (error) => {
      reject(error);
    });

    process.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp mix failed with code ${code}: ${stderr.trim()}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as YtdlpSearchCollection;
        const results = (parsed.entries ?? [])
          .map((entry) => toYoutubeResult(entry, mode))
          .filter((entry): entry is YoutubeSearchResult => Boolean(entry))
          .slice(0, limit);

        resolve(results);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function runYtdlpMixSuggestions(
  videoId: string,
  limit: number,
  mode: SearchMode,
  cookiesPath: string | null
): Promise<YoutubeSearchResult[]> {
  const mixUrls =
    mode === "music"
      ? [
          `https://www.youtube.com/watch?v=${videoId}&list=RDAMVM${videoId}`,
          `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`
        ]
      : [`https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`];

  for (const mixUrl of mixUrls) {
    try {
      const results = await runYtdlpMixRequest(mixUrl, limit, mode, cookiesPath);
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      console.error("yt-dlp mix source failed:", error);
    }
  }

  return [];
}

function mapApiItems(
  items: YoutubeSearchItem[] | undefined,
  mode: SearchMode
): YoutubeSearchResult[] {
  return (items ?? [])
    .map((item) => {
      const videoId = item.id?.videoId;
      const title = item.snippet?.title;
      const channelTitle = item.snippet?.channelTitle;

      if (!videoId || !title || !channelTitle) {
        return null;
      }

      const thumbnailUrl =
        item.snippet?.thumbnails?.high?.url ??
        item.snippet?.thumbnails?.medium?.url ??
        item.snippet?.thumbnails?.default?.url;

      const result: YoutubeSearchResult = {
        title,
        videoId,
        url: toDisplayUrl(videoId, mode),
        channelTitle
      };

      if (thumbnailUrl) {
        result.thumbnailUrl = thumbnailUrl;
      }

      return result;
    })
    .filter((item): item is YoutubeSearchResult => item !== null);
}

async function runYoutubeApiSearch(
  apiKey: string,
  query: string,
  maxResults: number,
  mode: SearchMode
): Promise<YoutubeSearchResult[]> {
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/search");
  endpoint.searchParams.set("part", "snippet");
  endpoint.searchParams.set("type", "video");
  endpoint.searchParams.set("maxResults", String(Math.max(1, Math.min(25, maxResults))));
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("key", apiKey);

  if (mode === "music") {
    endpoint.searchParams.set("videoCategoryId", "10");
  }

  const response = await fetch(endpoint);
  const payload = (await response.json()) as YoutubeSearchResponse;

  if (!response.ok) {
    const message = payload.error?.message ?? `YouTube API returned ${response.status}`;
    throw new Error(message);
  }

  return mapApiItems(payload.items, mode);
}

export function createYoutubeService(options: YoutubeServiceOptions): YoutubeService {
  const apiKey = options.apiKey;
  const ytdlpCookiesPath = options.ytdlpCookiesPath ?? null;
  let apiBackoffUntil = 0;

  function useApiNow(): boolean {
    return Date.now() >= apiBackoffUntil;
  }

  function registerApiFailure(error: unknown): void {
    if (!isYoutubeQuotaError(error)) {
      return;
    }

    const nextBackoffUntil = Date.now() + QUOTA_BACKOFF_MS;
    if (nextBackoffUntil <= apiBackoffUntil) {
      return;
    }

    apiBackoffUntil = nextBackoffUntil;
    console.warn(
      `YouTube Data API quota exceeded. Using yt-dlp fallback for ${Math.round(QUOTA_BACKOFF_MS / 60000)} minutes.`
    );
  }

  return {
    async searchTopVideo(
      query: string,
      mode: SearchMode = "music"
    ): Promise<YoutubeSearchResult | null> {
      if (!useApiNow()) {
        const fallbackResults = await runYtdlpSuggestions(
          query,
          1,
          mode,
          ytdlpCookiesPath
        );
        return fallbackResults[0] ?? null;
      }

      try {
        const apiResults = await runYoutubeApiSearch(apiKey, query, 1, mode);
        if (apiResults.length > 0) {
          return apiResults[0] ?? null;
        }

        const fallbackResults = await runYtdlpSuggestions(
          query,
          1,
          mode,
          ytdlpCookiesPath
        );
        return fallbackResults[0] ?? null;
      } catch (error) {
        registerApiFailure(error);
        console.error("YouTube Data API search failed; falling back to yt-dlp search:", error);
        const fallbackResults = await runYtdlpSuggestions(
          query,
          1,
          mode,
          ytdlpCookiesPath
        );
        return fallbackResults[0] ?? null;
      }
    },

    async searchSuggestions(
      query: string,
      limit: number,
      mode: SearchMode = "music"
    ): Promise<YoutubeSearchResult[]> {
      const boundedLimit = Math.max(1, Math.min(10, limit));
      if (!useApiNow()) {
        return await runYtdlpSuggestions(
          query,
          boundedLimit,
          mode,
          ytdlpCookiesPath
        );
      }

      try {
        const apiResults = await runYoutubeApiSearch(apiKey, query, boundedLimit, mode);
        if (apiResults.length > 0) {
          return apiResults;
        }

        return await runYtdlpSuggestions(
          query,
          boundedLimit,
          mode,
          ytdlpCookiesPath
        );
      } catch (error) {
        registerApiFailure(error);
        console.error("YouTube Data API suggestions failed; falling back to yt-dlp search:", error);
        return await runYtdlpSuggestions(
          query,
          boundedLimit,
          mode,
          ytdlpCookiesPath
        );
      }
    },

    async searchRelatedSuggestions(
      videoId: string,
      limit: number,
      mode: SearchMode = "music"
    ): Promise<YoutubeSearchResult[]> {
      const boundedLimit = Math.max(1, Math.min(25, limit));
      return await runYtdlpMixSuggestions(
        videoId,
        boundedLimit,
        mode,
        ytdlpCookiesPath
      );
    }
  };
}
