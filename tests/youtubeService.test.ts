import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createYoutubeService,
  extractYoutubeVideoId,
  rankMusicSearchResults
} from "../src/integrations/youtubeService.js";
import type { YoutubeSearchResult } from "../src/integrations/types.js";

function result(
  title: string,
  videoId: string,
  channelTitle = "Channel",
  durationSeconds?: number
): YoutubeSearchResult {
  const searchResult: YoutubeSearchResult = {
    title,
    videoId,
    url: `https://music.youtube.com/watch?v=${videoId}`,
    channelTitle
  };

  if (durationSeconds !== undefined) {
    searchResult.durationSeconds = durationSeconds;
  }

  return searchResult;
}

describe("YouTube music search ranking", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers pure official audio over reaction videos", () => {
    const ranked = rankMusicSearchResults("Deftones Digital Bath", [
      result("FIRST TIME HEARING Deftones - Digital Bath REACTION", "reaction", "Rock Reacts"),
      result("Deftones - Digital Bath (Official Audio)", "audio", "Deftones - Topic"),
      result("Deftones - Digital Bath lyrics", "lyrics", "Fan Upload")
    ]);

    expect(ranked.map((entry) => entry.videoId)).toEqual(["audio", "lyrics"]);
  });

  it("rejects commentary and common unofficial variants for normal music queries", () => {
    const ranked = rankMusicSearchResults("Massive Attack Teardrop", [
      result("Massive Attack - Teardrop vocal coach reacts", "reacts"),
      result("Teardrop - Massive Attack guitar cover", "cover"),
      result("Massive Attack - Teardrop karaoke instrumental", "karaoke"),
      result("Massive Attack - Teardrop", "topic", "Massive Attack - Topic")
    ]);

    expect(ranked.map((entry) => entry.videoId)).toEqual(["topic"]);
  });

  it("allows variants when the user explicitly asks for them", () => {
    const ranked = rankMusicSearchResults("Johnny Cash Hurt cover", [
      result("Johnny Cash - Hurt cover", "cover"),
      result("Johnny Cash - Hurt (Official Audio)", "official", "Johnny Cash - Topic")
    ]);

    expect(ranked.map((entry) => entry.videoId)).toContain("cover");
  });

  it("prefers results that match the requested artist over unrelated official audio", () => {
    const ranked = rankMusicSearchResults("ren losing it", [
      result("FISHER - Losing It (Official Audio)", "fisher", "FISHER"),
      result("REN 'LOSING IT' LYRIC VIDEO", "lyric", "Craig Attwater"),
      result("Ren - Losing It (FISHER Rap Version)", "ren", "Ren")
    ]);

    expect(ranked.map((entry) => entry.videoId)).toEqual(["ren", "lyric", "fisher"]);
  });

  it("penalizes short duration outliers that can sound sped up", () => {
    const ranked = rankMusicSearchResults("dynazty heartless madness", [
      result("Heartless Madness - Dynazty", "short", "Lynic", 189),
      result("Dynazty - Heartless Madness", "normal", "Music Uploads", 248),
      result("Dynazty - Heartless Madness (Lyrics)", "lyrics", "Lyrics Channel", 240),
      result("Dynazty - Heartless Madness", "alternate", "Rock Channel", 249)
    ]);

    const rankedIds = ranked.map((entry) => entry.videoId);
    expect(rankedIds.indexOf("normal")).toBeLessThan(rankedIds.indexOf("short"));
  });

  it("extracts video ids from common YouTube link formats", () => {
    expect(extractYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
    expect(extractYoutubeVideoId("<https://youtu.be/dQw4w9WgXcQ?si=abc123>")).toBe(
      "dQw4w9WgXcQ"
    );
    expect(extractYoutubeVideoId("music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
    expect(extractYoutubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
  });

  it("rejects spoofed or invalid YouTube links", () => {
    expect(extractYoutubeVideoId("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(extractYoutubeVideoId("https://www.youtube.com/watch?v=too-short")).toBeNull();
  });

  it("looks up pasted YouTube links by video id instead of searching", async () => {
    const fetchSpy = vi.fn(async (_input: unknown) => ({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "dQw4w9WgXcQ",
            snippet: {
              title: "Exact linked video",
              channelTitle: "Exact Channel",
              thumbnails: {
                default: {
                  url: "https://example.com/thumb.jpg"
                }
              }
            }
          }
        ]
      })
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const service = createYoutubeService({ apiKey: "youtube-api-key" });
    const resolved = await service.searchTopVideo(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ"
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/youtube/v3/videos");
    expect(requestUrl.searchParams.get("id")).toBe("dQw4w9WgXcQ");
    expect(requestUrl.searchParams.has("q")).toBe(false);
    expect(resolved).toMatchObject({
      title: "Exact linked video",
      videoId: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      channelTitle: "Exact Channel",
      sourceName: "YouTube"
    });
  });

  it("can skip slow yt-dlp fallback for nonessential lookups after quota errors", async () => {
    const fetchSpy = vi.fn(async (_input: unknown) => ({
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          message:
            "Quota exceeded for quota metric 'Search Queries' and limit 'Search Queries per day'"
        }
      })
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const service = createYoutubeService({ apiKey: "youtube-api-key" });

    await expect(
      service.searchTopVideo("slow recommendation", "music", { allowFallback: false })
    ).resolves.toBeNull();
    await expect(
      service.searchSuggestions("another recommendation", 5, "music", {
        allowFallback: false
      })
    ).resolves.toEqual([]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
