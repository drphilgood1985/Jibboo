import { afterEach, describe, expect, it, vi } from "vitest";
import { createSunoService, isSunoUrl } from "../src/integrations/sunoService.js";

const SONG_ID = "ab39a04d-b2e6-463b-9b8e-ddea725422f5";
const SHARE_URL = "https://suno.com/s/APHE76FV5TfWDJn2";
const SHARE_SONG_ID = "74d82472-b66d-4b79-84e8-9f006d05c1a4";

describe("Suno service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recognizes Suno song and share URLs", () => {
    expect(isSunoUrl(`https://suno.com/song/${SONG_ID}`)).toBe(true);
    expect(isSunoUrl(SHARE_URL)).toBe(true);
    expect(isSunoUrl("https://www.youtube.com/watch?v=abc")).toBe(false);
  });

  it("resolves a public Suno song URL to playable audio metadata", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl === `https://cdn1.suno.ai/${SONG_ID}.mp3` && init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-type": "audio/mp3"
          }
        });
      }

      if (requestUrl.startsWith("https://studio-api-prod.suno.com/api/oembed")) {
        return new Response(JSON.stringify({ title: "Life's a Soundtrack" }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`Unexpected fetch: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = createSunoService();
    const result = await service.resolveSong(`https://suno.com/song/${SONG_ID}`);

    expect(result).toEqual({
      songId: SONG_ID,
      title: "Life's a Soundtrack",
      pageUrl: `https://suno.com/song/${SONG_ID}`,
      audioUrl: `https://cdn1.suno.ai/${SONG_ID}.mp3`,
      playbackUrl: `https://cdn1.suno.ai/${SONG_ID}.mp3`,
      url: `https://suno.com/song/${SONG_ID}`,
      channelTitle: "Suno",
      sourceName: "Suno"
    });
  });

  it("resolves a Suno short share URL before building the audio URL", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl === SHARE_URL) {
        return {
          ok: true,
          url: `https://suno.com/song/${SHARE_SONG_ID}?sh=APHE76FV5TfWDJn2`,
          headers: new Headers({
            "content-type": "text/html"
          }),
          text: vi.fn(async () => "")
        } as unknown as Response;
      }

      if (requestUrl === `https://cdn1.suno.ai/${SHARE_SONG_ID}.mp3` && init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-type": "audio/mp3"
          }
        });
      }

      if (requestUrl.startsWith("https://studio-api-prod.suno.com/api/oembed")) {
        return new Response(JSON.stringify({ title: "Djinns' Tonic" }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }

      throw new Error(`Unexpected fetch: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = createSunoService();
    const result = await service.resolveSong(SHARE_URL);

    expect(result).toMatchObject({
      songId: SHARE_SONG_ID,
      title: "Djinns' Tonic",
      pageUrl: `https://suno.com/song/${SHARE_SONG_ID}`,
      playbackUrl: `https://cdn1.suno.ai/${SHARE_SONG_ID}.mp3`
    });
  });
});
