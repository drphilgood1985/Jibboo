import type {
  QueueableMedia,
  SpotifyTrack,
  YoutubeSearchResult
} from "../integrations/types.js";
import type { CommandContext } from "../types/appCommand.js";

export interface ResolveMediaResult {
  media: QueueableMedia | null;
  notFoundMessage: string;
}

function normalizeUrlCandidate(value: string): string {
  return value
    .trim()
    .replace(/^<(.+)>$/, "$1")
    .replace(/[),.!?;>]+$/, "");
}

export function extractFirstHttpUrl(input: string): URL | null {
  const trimmed = input.trim();
  const match = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  const rawUrl = normalizeUrlCandidate(match?.[0] ?? trimmed);

  if (!/^https?:\/\//i.test(rawUrl)) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function isYoutubeUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    host === "youtu.be" ||
    host.endsWith(".youtu.be") ||
    host === "youtube.com" ||
    host.endsWith(".youtube.com")
  );
}

function titleFromUrl(url: URL): string {
  const lastPathPart = url.pathname
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .at(-1);

  if (!lastPathPart) {
    return url.hostname;
  }

  let decodedPathPart = lastPathPart;
  try {
    decodedPathPart = decodeURIComponent(lastPathPart);
  } catch {
    decodedPathPart = lastPathPart;
  }

  const decoded = decodedPathPart
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return decoded.length > 0 ? decoded : url.hostname;
}

function toDirectUrlMedia(url: URL): QueueableMedia {
  return {
    title: titleFromUrl(url),
    url: url.toString(),
    channelTitle: url.hostname,
    sourceName: "Direct link"
  };
}

function toSpotifyMedia(
  spotifyTrack: SpotifyTrack,
  playbackResult: YoutubeSearchResult
): QueueableMedia {
  const media: QueueableMedia = {
    title: spotifyTrack.title,
    videoId: playbackResult.videoId,
    url: spotifyTrack.pageUrl,
    playbackUrl: playbackResult.playbackUrl ?? playbackResult.url,
    channelTitle: spotifyTrack.artistName ?? playbackResult.channelTitle,
    sourceName: "Spotify"
  };
  const thumbnailUrl = spotifyTrack.thumbnailUrl ?? playbackResult.thumbnailUrl;

  if (playbackResult.durationSeconds !== undefined) {
    media.durationSeconds = playbackResult.durationSeconds;
  }

  if (thumbnailUrl) {
    media.thumbnailUrl = thumbnailUrl;
  }

  return media;
}

export async function resolveInputMedia(
  input: string,
  context: CommandContext
): Promise<ResolveMediaResult> {
  const spotify = context.integrations.spotify;
  if (spotify?.isSpotifyUrl(input)) {
    const spotifyTrack = await spotify.resolveTrack(input);
    if (!spotifyTrack) {
      return {
        media: null,
        notFoundMessage:
          "No Spotify track was found. Paste a Spotify track link, not an album or playlist link."
      };
    }

    const playbackResult = await context.integrations.youtube.searchTopVideo(
      spotifyTrack.searchQuery,
      "music",
      {
        allowUnrequestedVariants: true,
        expectedArtistName: spotifyTrack.artistName,
        expectedTitle: spotifyTrack.title,
        preferOfficialAudio: false
      }
    );
    return {
      media: playbackResult ? toSpotifyMedia(spotifyTrack, playbackResult) : null,
      notFoundMessage: `No matching playable track was found for **${spotifyTrack.title}**.`
    };
  }

  const directUrl = extractFirstHttpUrl(input);

  if (directUrl && !isYoutubeUrl(directUrl)) {
    const suno = context.integrations.suno;
    if (suno?.isSunoUrl(input)) {
      const sunoSong = await suno.resolveSong(input);
      return {
        media: sunoSong,
        notFoundMessage:
          "No playable public Suno song was found. Use a public Suno `/song/...` or `/s/...` share URL."
      };
    }

    return {
      media: toDirectUrlMedia(directUrl),
      notFoundMessage: "No playable media was found for that link."
    };
  }

  return {
    media: await context.integrations.youtube.searchTopVideo(input),
    notFoundMessage: "No matching YouTube Music track was found."
  };
}
