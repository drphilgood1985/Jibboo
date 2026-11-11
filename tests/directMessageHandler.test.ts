import { ApplicationFlagsBitField, ChannelType, PermissionsBitField, PermissionFlagsBits, type Message } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDirectMessageHandler, splitDiscordMessage } from "../src/discord/directMessageHandler.js";
import { DAY_MS, historyMessage, historyPage, SUMMARY_END } from "./summaryFixtures.js";

function setup() {
  const member = { id: "member" };
  const bot = { id: "bot" };
  const history = vi.fn().mockResolvedValue(historyPage([historyMessage(SUMMARY_END - 1000)]));
  const channel = {
    id: "social",
    name: "social-chat",
    type: ChannelType.GuildText,
    permissionsFor: vi.fn().mockReturnValue(new PermissionsBitField([
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory
    ])),
    messages: { fetch: history },
    send: vi.fn()
  };
  const guild = {
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
    members: { fetch: vi.fn().mockResolvedValue(member), fetchMe: vi.fn().mockResolvedValue(bot) }
  };
  const send = vi.fn().mockResolvedValue(undefined);
  const application = { flags: new ApplicationFlagsBitField(ApplicationFlagsBitField.Flags.GatewayMessageContentLimited) };
  const message = {
    channel: { type: ChannelType.DM, send: vi.fn() },
    author: { id: "member", bot: false, send },
    content: "summary",
    client: {
      guilds: { fetch: vi.fn().mockResolvedValue(guild) },
      application: { fetch: vi.fn().mockResolvedValue(application) }
    },
    reply: vi.fn()
  };
  const generateReply = vi.fn().mockResolvedValue("Alice said hello.");
  const handler = createDirectMessageHandler({ guildId: "guild", summaryChannelId: "social", gemini: { generateReply } });
  const handle = () => handler(message as unknown as Message);
  return { channel, guild, message, send, history, generateReply, handle, member, bot, application };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("private summary request", () => {
  it("accepts a case-insensitive summary DM and sends everything privately", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SUMMARY_END);
    const context = setup();
    context.message.content = " \nSuMmArY\t";
    await context.handle();
    expect(context.send).toHaveBeenCalledTimes(2);
    expect(context.send.mock.calls[1]?.[0]).toMatchObject({
      content: expect.stringContaining("Alice said hello."),
      allowedMentions: { parse: [] }
    });
    expect(context.send.mock.calls[1]?.[0].content).toContain("1 message");
    expect(context.send.mock.calls[0]?.[0].content).toContain("last 150 messages or last 24 hours");
    expect(context.send.mock.calls[1]?.[0].content).toContain(`<t:${Math.floor((SUMMARY_END - DAY_MS) / 1000)}:f>`);
    expect(context.channel.send).not.toHaveBeenCalled();
    expect(context.message.reply).not.toHaveBeenCalled();
    expect(context.message.channel.send).not.toHaveBeenCalled();
    expect(context.guild.members.fetch).toHaveBeenCalledTimes(2);
    expect(context.guild.members.fetch).toHaveBeenCalledWith({ user: "member", force: true });
  });

  it.each(["guild", "bot", "other words"])("ignores %s messages", async (kind) => {
    const context = setup();
    if (kind === "guild") context.message.channel.type = ChannelType.GuildText;
    if (kind === "bot") context.message.author.bot = true;
    if (kind === "other words") context.message.content = "please summary";
    await context.handle();
    expect(context.send).not.toHaveBeenCalled();
    expect(context.history).not.toHaveBeenCalled();
  });

  it("denies nonmembers before reading any channel history", async () => {
    const context = setup();
    context.guild.members.fetch.mockRejectedValue(new Error("Unknown member"));
    await context.handle();
    expect(context.history).not.toHaveBeenCalled();
    expect(context.generateReply).not.toHaveBeenCalled();
    expect(context.send.mock.calls[0]?.[0].content).toContain("only send a summary to server members");
  });

  it.each([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])(
    "denies a requester missing permission %s", async (missing) => {
      const context = setup();
      context.channel.permissionsFor.mockImplementation((member) => new PermissionsBitField(
        member === context.member
          ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory].filter((flag) => flag !== missing)
          : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
      ));
      await context.handle();
      expect(context.history).not.toHaveBeenCalled();
      expect(context.send.mock.calls[0]?.[0].content).toContain("only send a summary");
    }
  );

  it("explains missing bot permissions privately", async () => {
    const context = setup();
    context.channel.permissionsFor.mockImplementation((member) => new PermissionsBitField(
      member === context.bot ? [] : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
    ));
    await context.handle();
    expect(context.history).not.toHaveBeenCalled();
    expect(context.send.mock.calls[0]?.[0].content).toContain("I need View Channel and Read Message History");
  });

  it("withholds the summary if access is revoked during generation", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SUMMARY_END);
    const context = setup();
    context.guild.members.fetch.mockResolvedValueOnce(context.member).mockRejectedValueOnce(new Error("Left server"));
    await context.handle();
    expect(context.generateReply).toHaveBeenCalledTimes(1);
    expect(context.send.mock.calls.map((call) => call[0].content).join("\n")).not.toContain("Alice said hello.");
    expect(context.send.mock.calls[1]?.[0].content).toContain("only send a summary");
  });

  it("handles no activity without a Gemini request", async () => {
    const context = setup();
    context.history.mockResolvedValue(historyPage([]));
    await context.handle();
    expect(context.generateReply).not.toHaveBeenCalled();
    expect(context.send.mock.calls[1]?.[0].content).toContain("No messages available to summarize.");
  });

  it("shows the older covered time range when a quiet channel reaches beyond 24 hours", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SUMMARY_END);
    const context = setup();
    const oldest = historyMessage(SUMMARY_END - 3 * DAY_MS, "Earlier conversation");
    context.history.mockResolvedValue(historyPage([historyMessage(SUMMARY_END - 1000), oldest]));
    await context.handle();

    const content = context.send.mock.calls[1]?.[0].content;
    expect(content).toContain("Last 150 messages or last 24 hours, whichever includes more messages.");
    expect(content).toContain(`<t:${Math.floor(oldest.createdTimestamp / 1000)}:f>`);
    expect(content).toContain("2 messages");
    expect(context.generateReply.mock.calls[0]?.[0]).toContain("Earlier conversation");
  });

  it("reports a disabled Message Content Intent before fetching partial history", async () => {
    const context = setup();
    context.application.flags = new ApplicationFlagsBitField();
    await context.handle();
    expect(context.history).not.toHaveBeenCalled();
    expect(context.generateReply).not.toHaveBeenCalled();
    expect(context.send.mock.calls[0]?.[0].content).toContain("Message Content Intent needs to be enabled");
  });

  it("prevents overlapping requests from the same user", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SUMMARY_END);
    const context = setup();
    let finish: (value: string) => void = () => undefined;
    context.generateReply.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const first = context.handle();
    await vi.waitFor(() => expect(context.generateReply).toHaveBeenCalledTimes(1));
    await context.handle();
    expect(context.send.mock.calls.at(-1)?.[0].content).toContain("already putting your summary together");
    finish("Finished summary.");
    await first;
    expect(context.generateReply).toHaveBeenCalledTimes(1);
  });

  it("recovers from Gemini failure and releases the request lock", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SUMMARY_END);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const context = setup();
    context.generateReply.mockRejectedValueOnce(new Error("Gemini down"));
    await context.handle();
    expect(context.send.mock.calls.at(-1)?.[0].content).toContain("couldn't put the summary together");
    await context.handle();
    expect(context.generateReply).toHaveBeenCalledTimes(2);
    expect(context.send.mock.calls.at(-1)?.[0].content).toContain("Alice said hello.");
    expect(context.channel.send).not.toHaveBeenCalled();
  });

  it("does not read history or post publicly when a DM cannot be sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const context = setup();
    context.send.mockRejectedValue(new Error("Cannot send messages to this user"));
    await expect(context.handle()).resolves.toBeUndefined();
    expect(context.history).not.toHaveBeenCalled();
    expect(context.channel.send).not.toHaveBeenCalled();
  });

  it("splits long summaries into complete Discord-sized messages", async () => {
    vi.spyOn(Date, "now").mockReturnValue(SUMMARY_END);
    const context = setup();
    const text = "Topic recap.\n".repeat(600);
    context.generateReply.mockResolvedValue(text);
    await context.handle();
    const parts = context.send.mock.calls.slice(1).map((call) => call[0].content as string);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((part) => part.length <= 2000)).toBe(true);
    expect(parts.join("")).toContain(text);
  });
});

it("does not break emoji surrogate pairs when splitting DMs", () => {
  const text = "x".repeat(1999) + "🎉" + "y".repeat(2000);
  const parts = splitDiscordMessage(text);
  expect(parts.join("")).toBe(text);
  expect(parts[0]).toHaveLength(1999);
  expect(parts[1]?.startsWith("🎉")).toBe(true);
});
