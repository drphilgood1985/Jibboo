import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpotifyService, isSpotifyUrl } from "../src/integrations/spotifyService.js";

const TRACK_ID = "4uLU6hMCjMI75M1A2tKUQC";
const TRACK_URL = `https://open.spotify.com/track/${TRACK_ID}`;

function spotifyTrackHtml(): string {
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    "<title>Never Gonna Give You Up - song and lyrics by Rick Astley | Spotify</title>",
    '<meta property="og:title" content="Never Gonna Give You Up">',
    '<meta property="og:description" content="Rick Astley &#183; Whenever You Need Somebody &#183; Song &#183; 1987">',
    '<meta property="og:image" content="https://i.scdn.co/image/cover">',
    "</head>",
    "</html>"
  ].join("");
}

describe("Spotify service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recognizes Spotify track links and redirect links", () => {
    expect(isSpotifyUrl(TRACK_URL)).toBe(true);
    expect(isSpotifyUrl(`${TRACK_URL}?si=share-code`)).toBe(true);
    expect(isSpotifyUrl(`spotify:track:${TRACK_ID}`)).toBe(true);
    expect(isSpotifyUrl("https://spotify.link/example")).toBe(true);
    expect(isSpotifyUrl("https://open.spotify.com/album/6N9PS4QXF1D0OWPk0Sxtb4")).toBe(true);
    expect(isSpotifyUrl("https://www.youtube.com/watch?v=abc")).toBe(false);
  });

  it("resolves a Spotify track URL to searchable track metadata", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const requestUrl = String(url);
      if (requestUrl === TRACK_URL) {
        return new Response(spotifyTrackHtml(), {
          status: 200,
          headers: {
            "content-type": "text/html"
          }
        });
      }

      throw new Error(`Unexpected fetch: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = createSpotifyService();
    const result = await service.resolveTrack(`${TRACK_URL}?si=share-code`);

    expect(result).toEqual({
      trackId: TRACK_ID,
      title: "Never Gonna Give You Up",
      artistName: "Rick Astley",
      pageUrl: TRACK_URL,
      searchQuery: "Never Gonna Give You Up Rick Astley",
      thumbnailUrl: "https://i.scdn.co/image/cover"
    });
  });

  it("returns null for Spotify URLs that are not tracks", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("should not fetch non-track Spotify URLs");
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = createSpotifyService();
    const result = await service.resolveTrack(
      "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
    );

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows Spotify short links before resolving metadata", async () => {
    const shortUrl = "https://spotify.link/example";
    const fetchMock = vi.fn(async (url: unknown) => {
      const requestUrl = String(url);
      if (requestUrl === shortUrl) {
        return {
          ok: true,
          url: `${TRACK_URL}?si=share-code`,
          headers: new Headers({
            "content-type": "text/html"
          }),
          text: vi.fn(async () => "")
        } as unknown as Response;
      }

      if (requestUrl === TRACK_URL) {
        return new Response(spotifyTrackHtml(), {
          status: 200,
          headers: {
            "content-type": "text/html"
          }
        });
      }

      throw new Error(`Unexpected fetch: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = createSpotifyService();
    const result = await service.resolveTrack(shortUrl);

    expect(result?.trackId).toBe(TRACK_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
