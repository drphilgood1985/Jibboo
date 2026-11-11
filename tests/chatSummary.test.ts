import { Collection, type TextChannel } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSummaryMessages, summarizeChat } from "../src/core/chatSummary.js";
import { DAY_MS, historyMessage, historyPage, imageAttachment, SUMMARY_END } from "./summaryFixtures.js";

afterEach(() => vi.unstubAllGlobals());

describe("summary history", () => {
  it("keeps every message from a busy 24 hours, even when there are more than 150", async () => {
    const recent = Array.from({ length: 220 }, (_, i) => historyMessage(SUMMARY_END - 1000 - i));
    const boundary = historyMessage(SUMMARY_END - DAY_MS);
    const older = historyMessage(SUMMARY_END - DAY_MS - 1, "Too old");
    const fetch = vi.fn()
      .mockResolvedValueOnce(historyPage(recent.slice(0, 100)))
      .mockResolvedValueOnce(historyPage(recent.slice(100, 200)))
      .mockResolvedValueOnce(historyPage([...recent.slice(200), boundary, older]));

    const messages = await fetchSummaryMessages({ messages: { fetch } } as unknown as TextChannel, SUMMARY_END);

    expect(messages).toHaveLength(221);
    expect(messages[0]).toBe(boundary);
    expect(messages.at(-1)).toBe(recent[0]);
    expect(messages).not.toContain(older);
    expect(fetch.mock.calls[0]?.[0]).toEqual({
      limit: 100,
      before: ((BigInt(SUMMARY_END - 1420070400000)) << 22n).toString(),
      cache: false
    });
    expect(fetch.mock.calls[1]?.[0].before).toBe(recent[99]?.id);
    expect(fetch.mock.calls[2]?.[0].before).toBe(recent[199]?.id);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("extends a quiet day to exactly the latest 150 messages and discards older page overflow", async () => {
    const recent = Array.from({ length: 10 }, (_, i) => historyMessage(SUMMARY_END - 1000 - i));
    const older = Array.from({ length: 190 }, (_, i) => historyMessage(SUMMARY_END - DAY_MS - 1000 - i));
    const available = [...recent, ...older];
    const fetch = vi.fn()
      .mockResolvedValueOnce(historyPage(available.slice(0, 100)))
      .mockResolvedValueOnce(historyPage(available.slice(100)));

    const messages = await fetchSummaryMessages({ messages: { fetch } } as unknown as TextChannel, SUMMARY_END);

    expect(messages).toEqual(available.slice(0, 150).reverse());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns the latest 150 even when none were posted in the last 24 hours", async () => {
    const older = Array.from({ length: 250 }, (_, i) => historyMessage(SUMMARY_END - 3 * DAY_MS - i));
    const fetch = vi.fn()
      .mockResolvedValueOnce(historyPage(older.slice(0, 100)))
      .mockResolvedValueOnce(historyPage(older.slice(100, 200)));

    const messages = await fetchSummaryMessages({ messages: { fetch } } as unknown as TextChannel, SUMMARY_END);

    expect(messages).toEqual(older.slice(0, 150).reverse());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses all available history if the channel has fewer than 150 messages", async () => {
    const older = Array.from({ length: 12 }, (_, i) => historyMessage(SUMMARY_END - 4 * DAY_MS - i));
    const fetch = vi.fn().mockResolvedValue(historyPage(older));

    expect(await fetchSummaryMessages({ messages: { fetch } } as unknown as TextChannel, SUMMARY_END))
      .toEqual([...older].reverse());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not count system messages toward the 150-message minimum", async () => {
    const system = Array.from({ length: 99 }, (_, i) => historyMessage(SUMMARY_END - 1000 - i, "joined", { system: true }));
    const posts = Array.from({ length: 160 }, (_, i) => historyMessage(SUMMARY_END - 2 * DAY_MS - i));
    const available = [...system, ...posts];
    const fetch = vi.fn()
      .mockResolvedValueOnce(historyPage(available.slice(0, 100)))
      .mockResolvedValueOnce(historyPage(available.slice(100, 200)))
      .mockResolvedValueOnce(historyPage(available.slice(200)));

    expect(await fetchSummaryMessages({ messages: { fetch } } as unknown as TextChannel, SUMMARY_END))
      .toEqual(posts.slice(0, 150).reverse());
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("excludes messages at/after the frozen end and system messages", async () => {
    const keep = historyMessage(SUMMARY_END - 1);
    const fetch = vi.fn().mockResolvedValue(historyPage([
      historyMessage(SUMMARY_END), historyMessage(SUMMARY_END + 1),
      historyMessage(SUMMARY_END - 2, "joined", { system: true }), keep
    ]));
    expect(await fetchSummaryMessages({ messages: { fetch } } as unknown as TextChannel, SUMMARY_END))
      .toEqual([keep]);
  });

  it("handles an empty channel without further pagination", async () => {
    const fetch = vi.fn().mockResolvedValue(historyPage([]));
    expect(await fetchSummaryMessages({ messages: { fetch } } as unknown as TextChannel, SUMMARY_END)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("chat recap", () => {
  it("skips Gemini when no messages were posted", async () => {
    const generateReply = vi.fn();
    expect(await summarizeChat([], "social-chat", SUMMARY_END, { generateReply })).toMatchObject({ messageCount: 0 });
    expect(generateReply).not.toHaveBeenCalled();
  });

  it("includes authors, reply references, links, and embed text, with untrusted-data instructions", async () => {
    const message = historyMessage(SUMMARY_END - 1000, "Let's meet Friday.", {
      embeds: [{ title: "Event", description: "7pm downtown", fields: [{ name: "Venue", value: "Cafe" }], footer: { text: "RSVP" }, url: "https://example.com/event" }],
      reference: { messageId: "earlier-message" }
    });
    const generateReply = vi.fn().mockResolvedValue("Friday meetup at 7pm.");
    const result = await summarizeChat([message], "social-chat", SUMMARY_END, { generateReply });
    const prompt = generateReply.mock.calls[0]?.[0];
    for (const expected of ["Alice", "Friday", "7pm downtown", "Venue", "RSVP", "earlier-message", message.url, "untrusted source data"]) {
      expect(prompt).toContain(expected);
    }
    expect(result).toEqual({ text: "Friday meetup at 7pm.", messageCount: 1, imageCount: 0, analyzedImageCount: 0 });
  });

  it("gives Gemini the actual start time when selected messages extend beyond 24 hours", async () => {
    const oldest = historyMessage(SUMMARY_END - 3 * DAY_MS, "Monday plans.");
    const generateReply = vi.fn().mockResolvedValue("The group discussed plans earlier this week.");
    await summarizeChat([oldest, historyMessage(SUMMARY_END - 1000)], "social-chat", SUMMARY_END, { generateReply });
    expect(generateReply.mock.calls[0]?.[0]).toContain("last 150 messages or the last 24 hours");
    expect(generateReply.mock.calls[0]?.[0]).toContain(`The exact window is ${new Date(oldest.createdTimestamp).toISOString()}`);
  });

  it("sends attached and embedded images as labeled image data and avoids duplicate previews", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response("image bytes", { headers: { "content-type": "image/webp" } }));
    vi.stubGlobal("fetch", fetch);
    const attachment = imageAttachment() as any;
    const message = historyMessage(SUMMARY_END - 1000, "This is us", {
      attachments: new Collection([["attachment", attachment]]),
      embeds: [
        { image: { url: attachment.url, proxyURL: attachment.proxyURL }, fields: [] },
        { image: { url: "https://example.com/meme.png", proxyURL: "https://images-ext-1.discordapp.net/external/abc/meme.png" }, fields: [] }
      ]
    });
    const generateReply = vi.fn().mockResolvedValue("Alice shared a meme about the meetup.");
    const result = await summarizeChat([message], "social-chat", SUMMARY_END, { generateReply });
    const images = generateReply.mock.calls[0]?.[1];
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ mimeType: "image/webp", data: Buffer.from("image bytes").toString("base64"), label: expect.stringContaining(message.url) });
    expect(generateReply.mock.calls[0]?.[0]).toContain("OCR");
    expect(result).toMatchObject({ imageCount: 2, analyzedImageCount: 2 });
  });

  it("still summarizes when an image cannot be downloaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("expired")));
    const generateReply = vi.fn().mockResolvedValue("A meetup was discussed.");
    const message = historyMessage(SUMMARY_END - 1000, "Meetup", { attachments: new Collection([["image", imageAttachment()]]) });
    expect(await summarizeChat([message], "social-chat", SUMMARY_END, { generateReply }))
      .toMatchObject({ imageCount: 1, analyzedImageCount: 0 });
    expect(generateReply.mock.calls[0]?.[1]).toEqual([]);
  });

  it("retries a failed vision request as text without pretending images were read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("image", { headers: { "content-type": "image/png" } })));
    const generateReply = vi.fn().mockRejectedValueOnce(new Error("vision unavailable")).mockResolvedValueOnce("Text recap.");
    const message = historyMessage(SUMMARY_END - 1000, "Meetup", { attachments: new Collection([["image", imageAttachment()]]) });
    const result = await summarizeChat([message], "social-chat", SUMMARY_END, { generateReply });
    expect(generateReply).toHaveBeenCalledTimes(2);
    expect(generateReply.mock.calls[1]?.[0]).toContain("No image data is available");
    expect(generateReply.mock.calls[1]).toHaveLength(1);
    expect(result.analyzedImageCount).toBe(0);
  });

  it("batches a busy day and merges all portions without dropping text", async () => {
    const messages = Array.from({ length: 20 }, (_, i) => historyMessage(SUMMARY_END - 1000 + i, `Topic ${i}: ${"x".repeat(3000)}`));
    const generateReply = vi.fn().mockResolvedValue("Partial recap.");
    await summarizeChat(messages, "social-chat", SUMMARY_END, { generateReply });
    expect(generateReply.mock.calls.length).toBeGreaterThan(2);
    const sourcePrompts = generateReply.mock.calls.slice(0, -1).map((call) => call[0]).join("\n");
    for (let i = 0; i < 20; i++) {
      expect(sourcePrompts).toContain(`Topic ${i}:`);
    }
    expect(generateReply.mock.calls.at(-1)?.[0]).toContain("Combine the following partial recaps");
  });

  it("bounds image batches and attempts the 40 most recent images", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("image", { headers: { "content-type": "image/png" } })));
    const messages = Array.from({ length: 42 }, (_, i) => historyMessage(SUMMARY_END - 1000 + i, `Meme ${i}`, {
      attachments: new Collection([["image", imageAttachment(i)]])
    }));
    const generateReply = vi.fn().mockResolvedValue("Memes.");
    const result = await summarizeChat(messages, "social-chat", SUMMARY_END, { generateReply });
    const images = generateReply.mock.calls.flatMap((call) => call[1] ?? []);
    expect(result).toMatchObject({ messageCount: 42, imageCount: 42, analyzedImageCount: 40 });
    expect(images).toHaveLength(40);
    expect(images[0].label).toContain("meme-2.png");
    expect(generateReply.mock.calls.every((call) => (call[1]?.length ?? 0) <= 3)).toBe(true);
  });

  it("does not send video attachments as images", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const generateReply = vi.fn().mockResolvedValue("Shared a video.");
    const message = historyMessage(SUMMARY_END - 1000, "Video", {
      attachments: new Collection([["video", { ...imageAttachment(), contentType: "video/mp4" }]])
    });
    expect((await summarizeChat([message], "social-chat", SUMMARY_END, { generateReply })).imageCount).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports missing message content instead of inventing a recap", async () => {
    const generateReply = vi.fn();
    await expect(summarizeChat([historyMessage(SUMMARY_END - 1000, "")], "social-chat", SUMMARY_END, { generateReply }))
      .rejects.toThrow("Message Content intent");
    expect(generateReply).not.toHaveBeenCalled();
  });
});
