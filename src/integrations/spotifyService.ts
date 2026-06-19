import type { SpotifyService, SpotifyTrack } from "./types.js";

const SPOTIFY_PAGE_HOSTS = new Set([
  "open.spotify.com",
  "www.open.spotify.com",
  "spotify.com",
  "www.spotify.com"
]);
const SPOTIFY_REDIRECT_HOSTS = new Set(["spotify.link", "www.spotify.link"]);
const SPOTIFY_TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_TRACK_URI_PATTERN = /^spotify:track:([A-Za-z0-9]{22})$/i;
const REQUEST_TIMEOUT_MS = 10_000;
const REQUEST_HEADERS = {
  accept: "text/html,application/json;q=0.9,*/*;q=0.8",
  "user-agent": "Jibboo/0.1 Spotify resolver"
};

function normalizeUrlCandidate(value: string): string {
  return value
    .trim()
    .replace(/^<(.+)>$/, "$1")
    .replace(/[),.!?;>]+$/, "");
}

function extractFirstUrl(input: string): URL | null {
  const trimmed = input.trim();
  const match = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  const rawUrl = normalizeUrlCandidate(match?.[0] ?? trimmed);

  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function normalizePathParts(url: URL): string[] {
  return url.pathname
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function canonicalTrackPageUrl(trackId: string): string {
  return `https://open.spotify.com/track/${trackId}`;
}

function hostIsSpotify(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return SPOTIFY_PAGE_HOSTS.has(host) || SPOTIFY_REDIRECT_HOSTS.has(host);
}

function extractTrackIdFromUrl(url: URL): string | null {
  if (!SPOTIFY_PAGE_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  const parts = normalizePathParts(url);
  const trackIndex = parts.findIndex((part) => part.toLowerCase() === "track");
  const rawTrackId = trackIndex >= 0 ? parts[trackIndex + 1] : null;
  const trackId = rawTrackId?.split(/[?#]/)[0] ?? null;

  return trackId && SPOTIFY_TRACK_ID_PATTERN.test(trackId) ? trackId : null;
}

function extractTrackIdFromInput(input: string): string | null {
  const uriMatch = input.trim().match(SPOTIFY_TRACK_URI_PATTERN);
  if (uriMatch?.[1]) {
    return uriMatch[1];
  }

  const url = extractFirstUrl(input);
  return url ? extractTrackIdFromUrl(url) : null;
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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, codepoint: string) => String.fromCodePoint(Number(codepoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, codepoint: string) =>
      String.fromCodePoint(Number.parseInt(codepoint, 16))
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(value: string | null): string | null {
  const cleaned = value ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim() : "";
  return cleaned.length > 0 ? cleaned : null;
}

function extractMetaContent(html: string, name: string): string | null {
  const tagPattern = /<meta\b[^>]*>/gi;
  const attributePattern = /([a-zA-Z:-]+)\s*=\s*(["'])(.*?)\2/g;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagPattern.exec(html)) !== null) {
    const tag = tagMatch[0];
    const attributes = new Map<string, string>();
    let attributeMatch: RegExpExecArray | null;

    while ((attributeMatch = attributePattern.exec(tag)) !== null) {
      const key = attributeMatch[1]?.toLowerCase();
      const value = attributeMatch[3];
      if (key && value) {
        attributes.set(key, value);
      }
    }

    const metaName = attributes.get("property") ?? attributes.get("name");
    if (metaName?.toLowerCase() === name.toLowerCase()) {
      return cleanText(attributes.get("content") ?? null);
    }
  }

  return null;
}

function extractHtmlTitle(html: string): string | null {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  return cleanText(title);
}

function parseJsonLd(html: string): { name: string | null; description: string | null } {
  const match = html.match(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!match?.[1]) {
    return { name: null, description: null };
  }

  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { name: null, description: null };
    }

    const record = parsed as Record<string, unknown>;
    return {
      name: typeof record.name === "string" ? cleanText(record.name) : null,
      description:
        typeof record.description === "string" ? cleanText(record.description) : null
    };
  } catch {
    return { name: null, description: null };
  }
}

function extractArtistName(description: string | null, pageTitle: string | null): string | null {
  const metaSegments = description
    ?.split(/\s*\u00b7\s*/u)
    .map((part) => cleanText(part))
    .filter((part): part is string => Boolean(part));
  if (metaSegments && metaSegments.length >= 3) {
    const songIndex = metaSegments.findIndex((part) => part.toLowerCase() === "song");
    if (songIndex === 0) {
      return metaSegments[1] ?? null;
    }

    if (songIndex > 0) {
      return metaSegments[0] ?? null;
    }

    return metaSegments[0] ?? null;
  }

  const jsonLdMatch = description?.match(/Song\s*\u00b7\s*([^\u00b7]+)/iu);
  const jsonLdArtist = cleanText(jsonLdMatch?.[1] ?? null);
  if (jsonLdArtist) {
    return jsonLdArtist;
  }

  const titleMatch = pageTitle?.match(/\s-\ssong and lyrics by\s+(.+?)\s+\|\s+Spotify$/i);
  return cleanText(titleMatch?.[1] ?? null);
}

function buildSearchQuery(title: string, artistName: string | null): string {
  return [title, artistName].filter((part): part is string => Boolean(part)).join(" ");
}

function extractTrackIdFromResponseUrl(responseUrl: string, fallbackTrackId: string): string {
  if (!responseUrl) {
    return fallbackTrackId;
  }

  try {
    return extractTrackIdFromUrl(new URL(responseUrl)) ?? fallbackTrackId;
  } catch {
    return fallbackTrackId;
  }
}

async function resolveRedirectTrackId(input: string): Promise<string | null> {
  const url = extractFirstUrl(input);
  if (!url || !SPOTIFY_REDIRECT_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  const response = await fetchWithTimeout(url.toString(), {
    redirect: "follow"
  });
  if (!response.url) {
    return null;
  }

  return extractTrackIdFromUrl(new URL(response.url));
}

async function fetchTrackPage(trackId: string): Promise<{
  trackId: string;
  html: string;
  pageUrl: string;
} | null> {
  const response = await fetchWithTimeout(canonicalTrackPageUrl(trackId), {
    redirect: "follow"
  });

  if (!response.ok) {
    return null;
  }

  const finalTrackId = extractTrackIdFromResponseUrl(response.url, trackId);

  return {
    trackId: finalTrackId,
    html: await response.text(),
    pageUrl: canonicalTrackPageUrl(finalTrackId)
  };
}

async function resolveTrackId(input: string): Promise<string | null> {
  const directTrackId = extractTrackIdFromInput(input);
  if (directTrackId) {
    return directTrackId;
  }

  return resolveRedirectTrackId(input);
}

export function isSpotifyUrl(input: string): boolean {
  if (extractTrackIdFromInput(input)) {
    return true;
  }

  const url = extractFirstUrl(input);
  return url ? hostIsSpotify(url) : false;
}

export function createSpotifyService(): SpotifyService {
  return {
    isSpotifyUrl,
    async resolveTrack(input: string): Promise<SpotifyTrack | null> {
      const trackId = await resolveTrackId(input);
      if (!trackId) {
        return null;
      }

      const page = await fetchTrackPage(trackId);
      if (!page) {
        return null;
      }

      const jsonLd = parseJsonLd(page.html);
      const title =
        jsonLd.name ??
        extractMetaContent(page.html, "og:title") ??
        extractMetaContent(page.html, "twitter:title") ??
        null;
      if (!title) {
        return null;
      }

      const description =
        extractMetaContent(page.html, "og:description") ??
        extractMetaContent(page.html, "twitter:description") ??
        jsonLd.description;
      const pageTitle = extractHtmlTitle(page.html);
      const artistName = extractArtistName(description, pageTitle);
      const thumbnailUrl =
        extractMetaContent(page.html, "og:image") ??
        extractMetaContent(page.html, "twitter:image");
      const track: SpotifyTrack = {
        trackId: page.trackId,
        title,
        artistName,
        pageUrl: page.pageUrl,
        searchQuery: buildSearchQuery(title, artistName)
      };

      if (thumbnailUrl) {
        track.thumbnailUrl = thumbnailUrl;
      }

      return track;
    }
  };
}
