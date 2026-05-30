import { spawn } from "node:child_process";
import { buildYtdlpArgs, YTDLP_EXECUTABLE } from "../config/mediaTools.js";
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

interface YoutubeVideoItem {
  id?: string;
  snippet?: YoutubeSearchItem["snippet"];
}

interface YoutubeVideosResponse {
  items?: YoutubeVideoItem[];
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
const YTDLP_TIMEOUT_MS = 25_000;
const MUSIC_TOP_RESULT_LIMIT = 12;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "audio",
  "by",
  "feat",
  "ft",
  "full",
  "hd",
  "hq",
  "lyrics",
  "lyric",
  "music",
  "official",
  "or",
  "song",
  "the",
  "to",
  "video",
  "with"
]);

const REACTION_OR_COMMENTARY_PATTERNS = [
  /\b(?:reaction|reacts?|reacting)\b/i,
  /\bfirst\s+time\s+(?:hearing|listening|watching)\b/i,
  /\b(?:review|breakdown|analysis|commentary|explained)\b/i,
  /\b(?:vocal\s+coach|producer|rapper|musician|teacher)\s+reacts?\b/i
];

const VARIANT_PATTERNS = [
  {
    pattern: /\b(?:cover|covers|covered)\b/i,
    queryTerms: ["cover"],
    hardBlock: true,
    penalty: 260
  },
  {
    pattern: /\b(?:karaoke|instrumental|tutorial|lesson|how\s+to\s+play)\b/i,
    queryTerms: ["karaoke", "instrumental", "tutorial", "lesson"],
    hardBlock: true,
    penalty: 260
  },
  {
    pattern: /\b(?:slowed|sped\s*up|nightcore|reverb|8d\s+audio)\b/i,
    queryTerms: ["slowed", "sped", "nightcore", "reverb", "8d"],
    hardBlock: true,
    penalty: 220
  },
  {
    pattern: /\b(?:remix|mashup)\b/i,
    queryTerms: ["remix", "mashup"],
    hardBlock: false,
    penalty: 140
  },
  {
    pattern: /\b(?:live|concert|performance)\b/i,
    queryTerms: ["live", "concert", "performance"],
    hardBlock: false,
    penalty: 120
  },
  {
    pattern: /\b(?:extended|loop|1\s*hour|10\s*hours?)\b/i,
    queryTerms: ["extended", "loop", "hour"],
    hardBlock: false,
    penalty: 100
  }
];

function toDisplayUrl(videoId: string, mode: SearchMode): string {
  if (mode === "music") {
    return `https://music.youtube.com/watch?v=${videoId}`;
  }

  return `https://www.youtube.com/watch?v=${videoId}`;
}

function toWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function sourceNameForMode(mode: SearchMode): string {
  return mode === "music" ? "YouTube Music" : "YouTube";
}

function sanitizeYoutubeVideoId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const videoId = value.trim();
  return YOUTUBE_VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
}

function isYoutubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "youtube.com" || host.endsWith(".youtube.com");
}

function normalizeUrlCandidate(value: string): string {
  return value
    .trim()
    .replace(/^<(.+)>$/, "$1")
    .replace(/[),.>]+$/, "");
}

function candidateUrlsFromInput(input: string): string[] {
  const normalized = normalizeUrlCandidate(input);
  const candidates = new Set<string>();

  candidates.add(normalized);

  const explicitUrlPattern = /https?:\/\/[^\s<>]+/gi;
  for (const match of normalized.matchAll(explicitUrlPattern)) {
    candidates.add(normalizeUrlCandidate(match[0]));
  }

  const bareUrlPattern =
    /(?:^|\s)((?:(?:www|music)\.)?youtube\.com\/[^\s<>]+|youtu\.be\/[^\s<>]+)/gi;
  for (const match of normalized.matchAll(bareUrlPattern)) {
    const bareUrl = match[1];
    if (bareUrl) {
      candidates.add(`https://${normalizeUrlCandidate(bareUrl)}`);
    }
  }

  return [...candidates].filter((candidate) => candidate.length > 0);
}

function extractVideoIdFromUrl(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase();

  if (host === "youtu.be" || host.endsWith(".youtu.be")) {
    const [videoId] = parsed.pathname.split("/").filter(Boolean);
    return sanitizeYoutubeVideoId(videoId);
  }

  if (!isYoutubeHost(host)) {
    return null;
  }

  const watchVideoId = sanitizeYoutubeVideoId(parsed.searchParams.get("v"));
  if (watchVideoId) {
    return watchVideoId;
  }

  const [kind, videoId] = parsed.pathname.split("/").filter(Boolean);
  if (kind && ["embed", "live", "shorts", "v"].includes(kind)) {
    return sanitizeYoutubeVideoId(videoId);
  }

  return null;
}

export function extractYoutubeVideoId(input: string): string | null {
  for (const candidate of candidateUrlsFromInput(input)) {
    try {
      const parsed = new URL(candidate);
      const videoId = extractVideoIdFromUrl(parsed);
      if (videoId) {
        return videoId;
      }
    } catch {
      // Keep checking other URL-shaped fragments in the input.
    }
  }

  return null;
}

function normalizeSearchText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ")
    .replace(/[^a-z0-9\s&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearchText(value: string): string[] {
  return normalizeSearchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token));
}

function includesAnyToken(value: string, tokens: string[]): boolean {
  const valueTokens = new Set(tokenizeSearchText(value));
  return tokens.some((token) => valueTokens.has(token));
}

function tokenSet(value: string): Set<string> {
  return new Set(tokenizeSearchText(value));
}

function toMusicSearchQuery(query: string): string {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (/\b(?:official|audio|lyrics?|video|live|cover|remix|karaoke|instrumental)\b/i.test(normalized)) {
    return normalized;
  }

  return `${normalized} official audio`;
}

function toSearchQuery(mode: SearchMode, query: string): string {
  if (mode === "music") {
    return toMusicSearchQuery(query);
  }

  return query.replace(/\s+/g, " ").trim();
}

function hasReactionOrCommentarySignal(result: YoutubeSearchResult): boolean {
  const searchable = `${result.title} ${result.channelTitle}`;
  return REACTION_OR_COMMENTARY_PATTERNS.some((pattern) => pattern.test(searchable));
}

function scoreMusicResult(
  query: string,
  result: YoutubeSearchResult
): { blocked: boolean; score: number } {
  if (hasReactionOrCommentarySignal(result)) {
    return { blocked: true, score: Number.NEGATIVE_INFINITY };
  }

  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(result.title);
  const normalizedChannel = normalizeSearchText(result.channelTitle);
  const queryTokens = tokenizeSearchText(query);
  const titleTokens = tokenSet(result.title);
  const channelTokens = tokenSet(result.channelTitle);
  let score = 0;

  if (/\bofficial\s+audio\b/i.test(result.title)) {
    score += 220;
  } else if (/\baudio\b/i.test(result.title)) {
    score += 90;
  }

  if (/\bofficial\s+(?:music\s+)?video\b/i.test(result.title)) {
    score += 50;
  }

  if (/\blyric(?:s|\s+video)?\b/i.test(result.title)) {
    score += 20;
  }

  if (/(?:^|\s)-\s*topic$/i.test(result.channelTitle) || /\btopic\b/i.test(result.channelTitle)) {
    score += 160;
  }

  if (/\bvevo\b/i.test(result.channelTitle)) {
    score += 90;
  }

  if (/\bofficial\b/i.test(result.channelTitle)) {
    score += 50;
  }

  if (normalizedQuery.length > 0 && normalizedTitle.includes(normalizedQuery)) {
    score += 90;
  }

  if (queryTokens.length > 0) {
    let matchedTitleTokens = 0;
    let matchedChannelTokens = 0;
    let missingTokens = 0;

    for (const token of queryTokens) {
      const titleHasToken = titleTokens.has(token);
      const channelHasToken = channelTokens.has(token);

      if (titleHasToken) {
        matchedTitleTokens += 1;
      }

      if (channelHasToken) {
        matchedChannelTokens += 1;
      }

      if (!titleHasToken && !channelHasToken) {
        missingTokens += 1;
      }
    }

    if (missingTokens === 0) {
      score += 120;
    }

    score += (matchedTitleTokens / queryTokens.length) * 120;
    score += (matchedChannelTokens / queryTokens.length) * 70;
    score -= (missingTokens / queryTokens.length) * 180;
  }

  for (const variant of VARIANT_PATTERNS) {
    if (!variant.pattern.test(result.title)) {
      continue;
    }

    if (includesAnyToken(query, variant.queryTerms)) {
      score += 20;
      continue;
    }

    if (variant.hardBlock) {
      return { blocked: true, score: Number.NEGATIVE_INFINITY };
    }

    score -= variant.penalty;
  }

  return { blocked: false, score };
}

export function rankMusicSearchResults(
  query: string,
  results: YoutubeSearchResult[]
): YoutubeSearchResult[] {
  return results
    .map((result, index) => ({
      index,
      result,
      ...scoreMusicResult(query, result)
    }))
    .filter((entry) => !entry.blocked)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.result);
}

function cleanSearchResults(
  query: string,
  results: YoutubeSearchResult[],
  mode: SearchMode
): YoutubeSearchResult[] {
  if (mode !== "music") {
    return results;
  }

  return rankMusicSearchResults(query, results);
}

function toYoutubeResult(
  entry: YtdlpSearchResult,
  mode: SearchMode,
  fallbackVideoId?: string,
  sourceName = sourceNameForMode(mode)
): YoutubeSearchResult | null {
  const videoId = sanitizeYoutubeVideoId(entry.id ?? fallbackVideoId);
  if (!videoId || !entry.title) {
    return null;
  }

  const result: YoutubeSearchResult = {
    title: entry.title,
    videoId,
    url:
      sourceName === "YouTube"
        ? entry.webpage_url ?? toWatchUrl(videoId)
        : toDisplayUrl(videoId, mode),
    channelTitle: entry.channel ?? entry.uploader ?? "Unknown channel",
    sourceName
  };

  if (entry.thumbnail) {
    result.thumbnailUrl = entry.thumbnail;
  }

  return result;
}

function runYtdlpVideoLookup(
  videoId: string,
  mode: SearchMode,
  cookiesPath: string | null
): Promise<YoutubeSearchResult | null> {
  return new Promise((resolve, reject) => {
    const process = spawn(
      YTDLP_EXECUTABLE,
      ytdlpArgs(["--dump-single-json", "--no-playlist", toWatchUrl(videoId)], cookiesPath),
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      process.kill("SIGKILL");
      reject(new Error(`yt-dlp video lookup timed out after ${YTDLP_TIMEOUT_MS / 1000}s.`));
    }, YTDLP_TIMEOUT_MS);

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      fn();
    };

    process.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    process.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    process.on("error", (error) => {
      finish(() => {
        reject(error);
      });
    });

    process.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(`yt-dlp video lookup failed with code ${code}: ${stderr.trim()}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout) as YtdlpSearchResult;
          resolve(toYoutubeResult(parsed, mode, videoId, "YouTube"));
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}

function toYtdlpQuery(mode: SearchMode, query: string): string {
  return toSearchQuery(mode, query);
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

function ytdlpArgs(args: string[], cookiesPath: string | null): string[] {
  return buildYtdlpArgs(withCookiesArgs(args, cookiesPath));
}

function runYtdlpSuggestions(
  query: string,
  limit: number,
  mode: SearchMode,
  cookiesPath: string | null
): Promise<YoutubeSearchResult[]> {
  return new Promise((resolve, reject) => {
    const process = spawn(
      YTDLP_EXECUTABLE,
      ytdlpArgs(
        ["--dump-single-json", "--no-playlist", ytdlpSearchTerm(mode, query, limit)],
        cookiesPath
      ),
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      process.kill("SIGKILL");
      reject(new Error(`yt-dlp search timed out after ${YTDLP_TIMEOUT_MS / 1000}s.`));
    }, YTDLP_TIMEOUT_MS);

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      fn();
    };

    process.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    process.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    process.on("error", (error) => {
      finish(() => {
        reject(error);
      });
    });

    process.on("close", (code) => {
      finish(() => {
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
      YTDLP_EXECUTABLE,
      ytdlpArgs(
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
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      process.kill("SIGKILL");
      reject(new Error(`yt-dlp mix lookup timed out after ${YTDLP_TIMEOUT_MS / 1000}s.`));
    }, YTDLP_TIMEOUT_MS);

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      fn();
    };

    process.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    process.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    process.on("error", (error) => {
      finish(() => {
        reject(error);
      });
    });

    process.on("close", (code) => {
      finish(() => {
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
        channelTitle,
        sourceName: sourceNameForMode(mode)
      };

      if (thumbnailUrl) {
        result.thumbnailUrl = thumbnailUrl;
      }

      return result;
    })
    .filter((item): item is YoutubeSearchResult => item !== null);
}

function mapApiVideoItem(
  item: YoutubeVideoItem | undefined,
  mode: SearchMode
): YoutubeSearchResult | null {
  const videoId = sanitizeYoutubeVideoId(item?.id);
  const title = item?.snippet?.title;
  const channelTitle = item?.snippet?.channelTitle;

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
    url: toWatchUrl(videoId),
    channelTitle,
    sourceName: "YouTube"
  };

  if (thumbnailUrl) {
    result.thumbnailUrl = thumbnailUrl;
  }

  return result;
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
  endpoint.searchParams.set("q", toSearchQuery(mode, query));
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

async function runYoutubeApiVideoLookup(
  apiKey: string,
  videoId: string,
  mode: SearchMode
): Promise<YoutubeSearchResult | null> {
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.searchParams.set("part", "snippet");
  endpoint.searchParams.set("id", videoId);
  endpoint.searchParams.set("key", apiKey);

  const response = await fetch(endpoint);
  const payload = (await response.json()) as YoutubeVideosResponse;

  if (!response.ok) {
    const message = payload.error?.message ?? `YouTube API returned ${response.status}`;
    throw new Error(message);
  }

  return mapApiVideoItem(payload.items?.[0], mode);
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

  async function resolveDirectVideo(
    videoId: string,
    mode: SearchMode
  ): Promise<YoutubeSearchResult | null> {
    if (useApiNow()) {
      try {
        const apiResult = await runYoutubeApiVideoLookup(apiKey, videoId, mode);
        if (apiResult) {
          return apiResult;
        }
      } catch (error) {
        registerApiFailure(error);
        console.error("YouTube Data API video lookup failed; falling back to yt-dlp:", error);
      }
    }

    try {
      return await runYtdlpVideoLookup(videoId, mode, ytdlpCookiesPath);
    } catch (error) {
      console.error("yt-dlp video lookup failed for YouTube URL:", error);
      return null;
    }
  }

  return {
    async searchTopVideo(
      query: string,
      mode: SearchMode = "music"
    ): Promise<YoutubeSearchResult | null> {
      const directVideoId = extractYoutubeVideoId(query);
      if (directVideoId) {
        return resolveDirectVideo(directVideoId, mode);
      }

      if (!useApiNow()) {
        const fallbackResults = await runYtdlpSuggestions(
          query,
          mode === "music" ? MUSIC_TOP_RESULT_LIMIT : 1,
          mode,
          ytdlpCookiesPath
        );
        return cleanSearchResults(query, fallbackResults, mode)[0] ?? null;
      }

      try {
        const apiResults = await runYoutubeApiSearch(
          apiKey,
          query,
          mode === "music" ? MUSIC_TOP_RESULT_LIMIT : 1,
          mode
        );
        const rankedApiResults = cleanSearchResults(query, apiResults, mode);
        if (rankedApiResults.length > 0) {
          return rankedApiResults[0] ?? null;
        }

        const fallbackResults = await runYtdlpSuggestions(
          query,
          mode === "music" ? MUSIC_TOP_RESULT_LIMIT : 1,
          mode,
          ytdlpCookiesPath
        );
        return cleanSearchResults(query, fallbackResults, mode)[0] ?? null;
      } catch (error) {
        registerApiFailure(error);
        console.error("YouTube Data API search failed; falling back to yt-dlp search:", error);
        const fallbackResults = await runYtdlpSuggestions(
          query,
          mode === "music" ? MUSIC_TOP_RESULT_LIMIT : 1,
          mode,
          ytdlpCookiesPath
        );
        return cleanSearchResults(query, fallbackResults, mode)[0] ?? null;
      }
    },

    async searchSuggestions(
      query: string,
      limit: number,
      mode: SearchMode = "music"
    ): Promise<YoutubeSearchResult[]> {
      const boundedLimit = Math.max(1, Math.min(10, limit));
      const fetchLimit =
        mode === "music" ? Math.max(boundedLimit, Math.min(25, boundedLimit * 3)) : boundedLimit;
      if (!useApiNow()) {
        const fallbackResults = await runYtdlpSuggestions(
          query,
          fetchLimit,
          mode,
          ytdlpCookiesPath
        );
        return cleanSearchResults(query, fallbackResults, mode).slice(0, boundedLimit);
      }

      try {
        const apiResults = await runYoutubeApiSearch(apiKey, query, fetchLimit, mode);
        const rankedApiResults = cleanSearchResults(query, apiResults, mode);
        if (rankedApiResults.length > 0) {
          return rankedApiResults.slice(0, boundedLimit);
        }

        const fallbackResults = await runYtdlpSuggestions(
          query,
          fetchLimit,
          mode,
          ytdlpCookiesPath
        );
        return cleanSearchResults(query, fallbackResults, mode).slice(0, boundedLimit);
      } catch (error) {
        registerApiFailure(error);
        console.error("YouTube Data API suggestions failed; falling back to yt-dlp search:", error);
        const fallbackResults = await runYtdlpSuggestions(
          query,
          fetchLimit,
          mode,
          ytdlpCookiesPath
        );
        return cleanSearchResults(query, fallbackResults, mode).slice(0, boundedLimit);
      }
    },

    async searchRelatedSuggestions(
      videoId: string,
      limit: number,
      mode: SearchMode = "music"
    ): Promise<YoutubeSearchResult[]> {
      const boundedLimit = Math.max(1, Math.min(25, limit));
      const results = await runYtdlpMixSuggestions(
        videoId,
        boundedLimit,
        mode,
        ytdlpCookiesPath
      );
      return cleanSearchResults("", results, mode).slice(0, boundedLimit);
    }
  };
}
