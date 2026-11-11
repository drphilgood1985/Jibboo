import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSummaryImage } from "../src/integrations/summaryImages.js";

afterEach(() => vi.unstubAllGlobals());

describe("summary image downloads", () => {
  it.each([
    "http://cdn.discordapp.com/attachments/image.png",
    "https://cdn.discordapp.com.evil.test/image.png",
    "https://example.com/image.png",
    "https://127.0.0.1/image.png",
    "https://cdn.discordapp.com:8443/image.png",
    "https://user:password@cdn.discordapp.com/image.png"
  ])("does not fetch an untrusted URL: %s", async (url) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await loadSummaryImage({ url, label: "Meme" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requests a static proxy preview while preserving signed URL parameters", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("image", { headers: { "content-type": "image/webp; charset=binary" } }));
    vi.stubGlobal("fetch", fetch);
    const image = await loadSummaryImage({ url: "https://media.discordapp.net/attachments/1/meme.gif?ex=abc&hm=signed", label: "Alice's meme" });
    const url = fetch.mock.calls[0]?.[0] as URL;
    expect(url.searchParams.get("hm")).toBe("signed");
    expect(url.searchParams.get("format")).toBe("webp");
    expect(url.searchParams.get("animated")).toBe("false");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(image).toEqual({ mimeType: "image/webp", data: Buffer.from("image").toString("base64"), label: "Alice's meme" });
  });

  it.each([
    { status: 403, headers: { "content-type": "image/png" } },
    { status: 200, headers: { "content-type": "text/html" } },
    { status: 200, headers: { "content-type": "image/png", "content-length": String(3 * 1024 * 1024) } }
  ])("skips failed, unsupported, or oversized responses: %o", async (options) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data", options)));
    expect(await loadSummaryImage({ url: "https://cdn.discordapp.com/attachments/image.png", label: "Meme" })).toBeNull();
  });

  it("enforces the size limit even when Content-Length is absent", async () => {
    const { ReadableStream } = await import("node:stream/web");
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
      cancel
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "image/png" } })));
    expect(await loadSummaryImage({ url: "https://cdn.discordapp.com/attachments/image.png", label: "Meme" })).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });
});
