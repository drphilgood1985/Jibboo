import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiService } from "../src/integrations/geminiService.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function reply(text = "A meme about Friday."): Response {
  return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
}

describe("Gemini multimodal requests", () => {
  it("sends labeled inline images and supports existing text-only calls", async () => {
    const fetch = vi.fn().mockImplementation(async () => reply());
    vi.stubGlobal("fetch", fetch);
    const service = createGeminiService({ apiKey: "test-key", model: "gemini-2.5-flash" });
    const image = { mimeType: "image/png", data: "aW1hZ2U=", label: "Image from Alice's message" };
    expect(await service.generateReply("Summarize.", [image])).toBe("A meme about Friday.");
    const body = JSON.parse(fetch.mock.calls[0]?.[1].body);
    expect(body.contents[0].parts).toEqual([
      { text: "Summarize." }, { text: image.label },
      { inlineData: { mimeType: image.mimeType, data: image.data } }
    ]);
    await service.generateReply("Queue help.");
    expect(JSON.parse(fetch.mock.calls[1]?.[1].body).contents[0].parts).toEqual([{ text: "Queue help." }]);
  });

  it("keeps image context when discovering and retrying a fallback model", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "Model not found" } }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] }))
      .mockResolvedValueOnce(reply());
    vi.stubGlobal("fetch", fetch);
    const service = createGeminiService({ apiKey: "test-key", model: "old-model" });
    await service.generateReply("Summarize.", [{ mimeType: "image/png", data: "aW1hZ2U=", label: "Meme" }]);
    expect(String(fetch.mock.calls[2]?.[0])).toContain("gemini-2.5-flash:generateContent");
    expect(JSON.parse(fetch.mock.calls[2]?.[1].body)).toEqual(JSON.parse(fetch.mock.calls[0]?.[1].body));
  });

  it("rejects empty/blocked responses so they cannot masquerade as successful summaries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ candidates: [] })));
    const service = createGeminiService({ apiKey: "test-key", model: "gemini-2.5-flash" });
    await expect(service.generateReply("Summarize.")).rejects.toThrow("no text response");
  });
});
