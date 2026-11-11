import { Collection, type Message } from "discord.js";

export const SUMMARY_END = Date.parse("2026-11-10T18:00:00Z");
export const DAY_MS = 24 * 60 * 60 * 1000;

export function historyMessage(time: number, content = "Hello, friends!", overrides: object = {}): Message {
  const id = ((BigInt(time - 1420070400000)) << 22n).toString();
  return {
    id,
    content,
    cleanContent: content,
    createdTimestamp: time,
    system: false,
    author: { id: "member", username: "Alice", globalName: null },
    member: { displayName: "Alice" },
    url: `https://discord.com/channels/guild/social/${id}`,
    attachments: new Collection(),
    embeds: [],
    stickers: new Collection(),
    reference: null,
    ...overrides
  } as unknown as Message;
}

export function historyPage(messages: Message[]): Collection<string, Message> {
  return new Collection(messages.map((message) => [message.id, message]));
}

export function imageAttachment(index = 1): object {
  return {
    name: `meme-${index}.png`,
    description: "A captioned meme",
    contentType: "image/png",
    width: 1000,
    url: `https://cdn.discordapp.com/attachments/social/${index}/meme.png`,
    proxyURL: `https://media.discordapp.net/attachments/social/${index}/meme.png`
  };
}
