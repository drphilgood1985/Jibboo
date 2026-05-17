import { describe, expect, it } from "vitest";
import { rankMusicSearchResults } from "../src/integrations/youtubeService.js";
import type { YoutubeSearchResult } from "../src/integrations/types.js";

function result(
  title: string,
  videoId: string,
  channelTitle = "Channel"
): YoutubeSearchResult {
  return {
    title,
    videoId,
    url: `https://music.youtube.com/watch?v=${videoId}`,
    channelTitle
  };
}

describe("YouTube music search ranking", () => {
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
});
