import type { GeminiImage } from "./types.js";

export interface SummaryImageSource {
  url: string;
  label: string;
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"
]);

// Only download Discord attachments/proxies, never arbitrary URLs posted in chat.
function isDiscordImageUrl(url: URL): boolean {
  return url.protocol === "https:" && !url.username && !url.password && !url.port && (
    url.hostname === "cdn.discordapp.com" ||
    url.hostname === "media.discordapp.net" ||
    /^images-ext-\d+\.discordapp\.net$/.test(url.hostname)
  );
}

export async function loadSummaryImage(source: SummaryImageSource): Promise<GeminiImage | null> {
  try {
    const url = new URL(source.url);
    if (!isDiscordImageUrl(url)) {
      return null;
    }

    // Discord's media proxy can turn GIFs into a static WebP preview, and resize
    // large images. The original URL's signed query parameters are preserved.
    if (url.hostname !== "cdn.discordapp.com") {
      url.searchParams.set("format", "webp");
      url.searchParams.set("width", "1600");
      url.searchParams.set("height", "1600");
      url.searchParams.set("animated", "false");
    }

    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000)
    });
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (
      !response.ok || !response.body || !mimeType ||
      !SUPPORTED_MIME_TYPES.has(mimeType) ||
      Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES
    ) {
      await response.body?.cancel();
      return null;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        bytes += value.byteLength;
        if (bytes > MAX_IMAGE_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    if (bytes === 0) {
      return null;
    }
    return { mimeType, data: Buffer.concat(chunks).toString("base64"), label: source.label };
  } catch {
    // Missing, expired, unsupported, or oversized images must not block the recap.
    return null;
  }
}
