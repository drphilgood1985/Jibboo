import { ApplicationFlagsBitField, ChannelType, PermissionFlagsBits, type Message, type TextChannel } from "discord.js";
import { fetchSummaryMessages, getSummaryStartTimestamp, summarizeChat } from "../core/chatSummary.js";
import type { GeminiService } from "../integrations/types.js";

interface DirectMessageContext {
  guildId: string;
  summaryChannelId: string;
  gemini: GeminiService;
}

class SummaryAccessError extends Error {}

const HISTORY_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];

async function accessibleSummaryChannel(
  message: Message,
  context: DirectMessageContext
): Promise<TextChannel> {
  const guild = await message.client.guilds.fetch(context.guildId);
  const channel = await guild.channels.fetch(context.summaryChannelId, { force: true });
  if (channel?.type !== ChannelType.GuildText) {
    throw new SummaryAccessError("The summary channel isn't available right now. Please let the server admin know.");
  }

  const member = await guild.members.fetch({ user: message.author.id, force: true }).catch(() => null);
  if (!member || !channel.permissionsFor(member)?.has(HISTORY_PERMISSIONS)) {
    throw new SummaryAccessError("I can only send a summary to server members who can view #social-chat and read its message history.");
  }

  const bot = await guild.members.fetchMe({ force: true });
  if (!channel.permissionsFor(bot)?.has(HISTORY_PERMISSIONS)) {
    throw new SummaryAccessError("I need View Channel and Read Message History permissions in #social-chat before I can summarize it.");
  }
  return channel;
}

export function splitDiscordMessage(content: string): string[] {
  const parts: string[] = [];
  let remaining = content;
  while (remaining.length > 2000) {
    let boundary = remaining.lastIndexOf("\n", 2000);
    if (boundary < 1000) {
      boundary = remaining.lastIndexOf(" ", 2000);
    }
    if (boundary < 1000) {
      boundary = 2000;
    }
    if (/[\uD800-\uDBFF]/.test(remaining.charAt(boundary - 1))) {
      boundary--;
    }
    parts.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary);
  }
  if (remaining) {
    parts.push(remaining);
  }
  return parts;
}

// Keep request state local to the handler; no transcript or summary is persisted.
export function createDirectMessageHandler(context: DirectMessageContext): (message: Message) => Promise<void> {
  const inFlight = new Set<string>();
  return async (message) => {
    if (message.author.bot || message.channel.type !== ChannelType.DM ||
      message.content.trim().toLowerCase() !== "summary") {
      return;
    }

    async function send(content: string): Promise<void> {
      for (const part of splitDiscordMessage(content)) {
        await message.author.send({
          content: part,
          allowedMentions: { parse: [] }
        });
      }
    }

    if (inFlight.has(message.author.id)) {
      await send("I'm already putting your summary together. I'll send it here when it's ready.")
        .catch(() => undefined);
      return;
    }

    inFlight.add(message.author.id);
    const end = Date.now();
    try {
      const channel = await accessibleSummaryChannel(message, context);
      const application = await message.client.application?.fetch();
      if (!application?.flags.any([
        ApplicationFlagsBitField.Flags.GatewayMessageContent,
        ApplicationFlagsBitField.Flags.GatewayMessageContentLimited
      ])) {
        throw new SummaryAccessError("My Message Content Intent needs to be enabled in the Discord Developer Portal before I can read #social-chat for summaries. Please let the server admin know.");
      }
      await send("I'm catching up on the last 150 messages or last 24 hours of #social-chat, whichever includes more messages. I'll include readable image and meme context. This may take a minute.");
      const messages = await fetchSummaryMessages(channel, end);
      const summary = await summarizeChat(messages, channel.name, end, context.gemini);

      // Long requests may outlive membership/permission changes. Check again
      // before delivering any channel content to the requester.
      await accessibleSummaryChannel(message, context);
      const startSeconds = Math.floor(getSummaryStartTimestamp(messages, end) / 1000);
      const endSeconds = Math.floor(end / 1000);
      const lines = [
        `**#${channel.name} — catch-up summary**`,
        "Last 150 messages or last 24 hours, whichever includes more messages.",
        `<t:${startSeconds}:f> – <t:${endSeconds}:f> · ${summary.messageCount} ${summary.messageCount === 1 ? "message" : "messages"}`,
        "",
        summary.text
      ];
      if (summary.imageCount) {
        lines.push("", `Image context: ${summary.analyzedImageCount} of ${summary.imageCount} images analyzed.`);
        if (summary.analyzedImageCount < summary.imageCount) {
          lines.push("Some images couldn't be read or exceeded the limit (up to 40 recent images, 2 MiB each). Their visual context may be missing.");
        }
      }
      await send(lines.join("\n"));
    } catch (error) {
      if (!(error instanceof SummaryAccessError)) {
        console.error("Private summary request failed:", error);
      }
      await send(error instanceof SummaryAccessError
        ? error.message
        : "I couldn't put the summary together right now. Please try DMing `summary` again in a little while. If it keeps failing, ask the admin to check my Message Content intent, channel permissions, and Gemini configuration."
      ).catch(() => undefined);
    } finally {
      inFlight.delete(message.author.id);
    }
  };
}
