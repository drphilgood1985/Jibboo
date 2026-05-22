import type { SunoService, SunoSong } from "./types.js";

const SUNO_PAGE_HOSTS = new Set(["suno.com", "www.suno.com"]);
const SUNO_SONG_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUNO_SONG_ID_CAPTURE =
  /([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;
const REQUEST_TIMEOUT_MS = 10_000;
const REQUEST_HEADERS = {
  accept: "text/html,application/json;q=0.9,*/*;q=0.8",
  "user-agent": "Jibboo/0.1 Suno resolver"
};

function extractFirstUrl(input: string): URL | null {
  const trimmed = input.trim();
  const match = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  const rawUrl = (match?.[0] ?? trimmed).replace(/[),.!?;]+$/g, "");

  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function canonicalSongPageUrl(songId: string): string {
  return `https://suno.com/song/${songId}`;
}

function audioUrlForSong(songId: string): string {
  return `https://cdn1.suno.ai/${songId}.mp3`;
}

function normalizePathParts(url: URL): string[] {
  return url.pathname
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function extractSongIdFromUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const parts = normalizePathParts(url);

  if (SUNO_PAGE_HOSTS.has(host)) {
    const [kind, rawSongId] = parts;
    if ((kind === "song" || kind === "embed") && rawSongId && SUNO_SONG_ID_PATTERN.test(rawSongId)) {
      return rawSongId;
    }

    return null;
  }

  if (host.endsWith(".suno.ai")) {
    const match = url.pathname.match(SUNO_SONG_ID_CAPTURE);
    return match?.[1] ?? null;
  }

  return null;
}

function extractCanonicalSongId(html: string): string | null {
  const canonicalMatch = html.match(
    /<link\s+[^>]*rel=["']canonical["'][^>]*href=["']https:\/\/suno\.com\/song\/([^"']+)["']/i
  );
  const canonicalId = canonicalMatch?.[1]?.split(/[/?#]/)[0];
  if (canonicalId && SUNO_SONG_ID_PATTERN.test(canonicalId)) {
    return canonicalId;
  }

  const songIdMatch = html.match(SUNO_SONG_ID_CAPTURE);
  return songIdMatch?.[1] ?? null;
}

function extractSongIdFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (SUNO_SONG_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const url = extractFirstUrl(input);
  return url ? extractSongIdFromUrl(url) : null;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = new Headers(REQUEST_HEADERS);
  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers
    });
  } finally {
    clearTimeout(timeout);
  }
}

function getRecordString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const field = record[key];
  return typeof field === "string" && field.trim().length > 0 ? field.trim() : null;
}

function cleanTitle(title: string | null, songId: string): string {
  const cleaned = title?.replace(/\s+/g, " ").trim();
  return cleaned && cleaned.length > 0 ? cleaned : `Suno song ${songId.slice(0, 8)}`;
}

async function resolveShareSongId(url: URL): Promise<string | null> {
  const response = await fetchWithTimeout(url.toString(), {
    redirect: "follow"
  });

  if (!response.ok) {
    return null;
  }

  const finalUrl = new URL(response.url);
  const finalSongId = extractSongIdFromUrl(finalUrl);
  if (finalSongId) {
    return finalSongId;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    return null;
  }

  return extractCanonicalSongId(await response.text());
}

async function fetchOembedTitle(songId: string): Promise<string | null> {
  const endpoint = new URL("https://studio-api-prod.suno.com/api/oembed");
  endpoint.searchParams.set("url", canonicalSongPageUrl(songId));

  const response = await fetchWithTimeout(endpoint.toString(), {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    return null;
  }

  const parsed = await response.json() as unknown;
  return getRecordString(parsed, "title");
}

async function isPlayableAudioUrl(url: string): Promise<boolean> {
  const response = await fetchWithTimeout(url, {
    method: "HEAD",
    redirect: "follow"
  });

  if (!response.ok) {
    return false;
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.startsWith("audio/");
}

async function resolveSongId(input: string): Promise<string | null> {
  const directSongId = extractSongIdFromInput(input);
  if (directSongId) {
    return directSongId;
  }

  const url = extractFirstUrl(input);
  if (!url || !SUNO_PAGE_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  const [kind] = normalizePathParts(url);
  if (kind !== "s") {
    return null;
  }

  return resolveShareSongId(url);
}

export function isSunoUrl(input: string): boolean {
  if (extractSongIdFromInput(input)) {
    return true;
  }

  const url = extractFirstUrl(input);
  if (!url || !SUNO_PAGE_HOSTS.has(url.hostname.toLowerCase())) {
    return false;
  }

  const [kind] = normalizePathParts(url);
  return kind === "s";
}

export function createSunoService(): SunoService {
  return {
    isSunoUrl,
    async resolveSong(input: string): Promise<SunoSong | null> {
      const songId = await resolveSongId(input);
      if (!songId) {
        return null;
      }

      const audioUrl = audioUrlForSong(songId);
      if (!(await isPlayableAudioUrl(audioUrl))) {
        return null;
      }

      let oembedTitle: string | null = null;
      try {
        oembedTitle = await fetchOembedTitle(songId);
      } catch (error) {
        console.error("Suno metadata lookup failed:", error);
      }

      const title = cleanTitle(oembedTitle, songId);
      const pageUrl = canonicalSongPageUrl(songId);

      return {
        songId,
        title,
        pageUrl,
        audioUrl,
        playbackUrl: audioUrl,
        url: pageUrl,
        channelTitle: "Suno",
        sourceName: "Suno"
      };
    }
  };
}
