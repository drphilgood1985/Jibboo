import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type Guild,
  type GuildTextBasedChannel,
  type Message
} from "discord.js";
import type { GuildQueueState, QueueStore, Track } from "../core/queueStore.js";
import type {
  GeminiService,
  YoutubeSearchResult,
  YoutubeService
} from "../integrations/types.js";

export const CONTROL_IDS = {
  previous: "jibboo:previous",
  pause: "jibboo:pause",
  resume: "jibboo:resume",
  next: "jibboo:next",
  volumeDown: "jibboo:volumedown",
  volumeUp: "jibboo:volumeup",
  suggestions: "jibboo:suggestions"
} as const;

const SUGGESTION_LIMIT = 5;
const SUGGESTION_FETCH_LIMIT = 15;
const LLM_SUGGESTION_QUERY_LIMIT = 8;
const MAX_QUERY_LENGTH = 96;

function extractVideoIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host === "youtu.be" || host === "www.youtu.be") {
      const pathId = parsed.pathname.replace("/", "").trim();
      return pathId.length > 0 ? pathId : null;
    }

    if (host.endsWith("youtube.com")) {
      const videoId = parsed.searchParams.get("v");
      if (videoId) {
        return videoId;
      }

      const shortsMatch = parsed.pathname.match(/\/shorts\/([A-Za-z0-9_-]+)/);
      if (shortsMatch?.[1]) {
        return shortsMatch[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeSuggestionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ")
    .replace(
      /\b(official|audio|video|lyrics?|remaster(?:ed)?|live|visualizer|topic|hq|hd|4k|version|full|album|explicit|clean)\b/g,
      " "
    )
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalSuggestionKey(title: string): string {
  return normalizeSuggestionText(title).split(" ").filter(Boolean).slice(0, 8).join(" ");
}

function normalizeArtistName(channelTitle: string): string {
  return channelTitle
    .toLowerCase()
    .replace(/\s*-\s*topic\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelySameSong(seedTitle: string, candidateTitle: string): boolean {
  const seedKey = canonicalSuggestionKey(seedTitle);
  const candidateKey = canonicalSuggestionKey(candidateTitle);

  if (seedKey.length > 0 && seedKey === candidateKey) {
    return true;
  }

  if (seedKey.length === 0 || candidateKey.length === 0) {
    return false;
  }

  const seedWords = seedKey.split(" ").filter(Boolean);
  const candidateWords = candidateKey.split(" ").filter(Boolean);
  const minimumWordCount = Math.min(seedWords.length, candidateWords.length);

  if (minimumWordCount < 2) {
    return false;
  }

  return seedKey.startsWith(candidateKey) || candidateKey.startsWith(seedKey);
}

function parseGeminiSuggestionQueries(rawResponse: string): string[] {
  const trimmed = rawResponse.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const directContent = fencedMatch?.[1]?.trim() ?? trimmed;

  const candidates: string[] = [directContent];
  const firstBrace = directContent.indexOf("{");
  const lastBrace = directContent.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(directContent.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as
        | { queries?: unknown; songs?: unknown }
        | unknown[];
      const rawQueries = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.queries)
          ? parsed.queries
          : Array.isArray(parsed.songs)
            ? parsed.songs
            : [];

      const seen = new Set<string>();
      const normalized = rawQueries
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.replace(/\s+/g, " ").trim())
        .filter((value) => value.length > 0)
        .map((value) => value.slice(0, MAX_QUERY_LENGTH))
        .filter((value) => {
          const key = value.toLowerCase();
          if (seen.has(key)) {
            return false;
          }

          seen.add(key);
          return true;
        });

      if (normalized.length > 0) {
        return normalized.slice(0, LLM_SUGGESTION_QUERY_LIMIT);
      }
    } catch {
      continue;
    }
  }

  return [];
}

export class ControlPanelController {
  private readonly panelMessageByGuild = new Map<string, string>();

  private readonly suggestionCache = new Map<string, Map<string, YoutubeSearchResult>>();

  constructor(
    private readonly queueStore: QueueStore,
    private readonly youtubeService: YoutubeService,
    private readonly geminiService: GeminiService
  ) {}

  getSuggestion(guildId: string, suggestionValue: string): YoutubeSearchResult | null {
    const guildSuggestions = this.suggestionCache.get(guildId);
    if (!guildSuggestions) {
      return null;
    }

    return guildSuggestions.get(suggestionValue) ?? null;
  }

  async refreshForGuild(guild: Guild, controlChannelId: string): Promise<void> {
    const channel = guild.channels.cache.get(controlChannelId);
    if (
      !channel ||
      !channel.isTextBased() ||
      !("send" in channel) ||
      !("messages" in channel)
    ) {
      return;
    }

    const textChannel = channel as GuildTextBasedChannel;
    const state = this.queueStore.getSnapshot(guild.id);
    const historySeedTrack =
      state.history.length > 0 ? (state.history[state.history.length - 1] ?? null) : null;
    const seedTrack = state.current ?? state.queue[0] ?? historySeedTrack;
    const suggestions = await this.buildSuggestions(seedTrack, state);

    const embed = new EmbedBuilder()
      .setTitle("Jibboo Queue Control")
      .setColor(0x2f80ed)
      .setDescription("Need help with commands? Run `/howdo` in this channel.")
      .addFields(
        {
          name: "Now Playing",
          value: state.current
            ? `[${state.current.title}](${state.current.url})\\nby ${state.current.channelTitle}`
            : "Nothing playing"
        },
        {
          name: "Queue",
          value:
            state.queue.length > 0
              ? state.queue
                  .slice(0, 5)
                  .map((track, index) => `${index + 1}. ${track.title}`)
                  .join("\\n")
              : "Queue is empty"
        },
        {
          name: "Volume",
          value: `${state.volume}%`,
          inline: true
        }
      )
      .setFooter({ text: "Use buttons/dropdown for playback controls. Need help? `/howdo`." });

    const primaryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(CONTROL_IDS.previous)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(CONTROL_IDS.pause).setLabel("Pause").setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(CONTROL_IDS.resume)
        .setLabel("Resume")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(CONTROL_IDS.next).setLabel("Next").setStyle(ButtonStyle.Secondary)
    );

    const volumeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(CONTROL_IDS.volumeDown)
        .setLabel("Volume -")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(CONTROL_IDS.volumeUp)
        .setLabel("Volume +")
        .setStyle(ButtonStyle.Secondary)
    );

    const suggestionOptions =
      suggestions.length > 0
        ? suggestions.map((suggestion) => {
            return {
              label: suggestion.title.slice(0, 100),
              description: suggestion.channelTitle.slice(0, 100),
              value: suggestion.videoId
            };
          })
        : [
            {
              label: "No suggestions available",
              description: "Play a song first to generate suggestions",
              value: "none"
            }
          ];

    const suggestionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CONTROL_IDS.suggestions)
        .setPlaceholder(
          suggestions.length > 0 ? "Suggestions: queue one as play-next" : "No suggestions available"
        )
        .setDisabled(suggestions.length === 0)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(suggestionOptions)
    );

    const payload = {
      embeds: [embed],
      components: [primaryRow, volumeRow, suggestionRow]
    };

    const existingMessageId = this.panelMessageByGuild.get(guild.id);

    if (!existingMessageId) {
      const sentMessage = await textChannel.send(payload);
      this.panelMessageByGuild.set(guild.id, sentMessage.id);
      this.setSuggestionCache(guild.id, suggestions);
      return;
    }

    const existingMessage = await this.fetchMessage(textChannel, existingMessageId);
    if (!existingMessage) {
      const sentMessage = await textChannel.send(payload);
      this.panelMessageByGuild.set(guild.id, sentMessage.id);
      this.setSuggestionCache(guild.id, suggestions);
      return;
    }

    await existingMessage.edit(payload);
    this.setSuggestionCache(guild.id, suggestions);
  }

  private setSuggestionCache(guildId: string, suggestions: YoutubeSearchResult[]): void {
    this.suggestionCache.set(
      guildId,
      new Map(suggestions.map((suggestion) => [suggestion.videoId, suggestion]))
    );
  }

  private async buildSuggestions(
    seedTrack: Track | null,
    state: GuildQueueState
  ): Promise<YoutubeSearchResult[]> {
    if (!seedTrack) {
      return [];
    }

    const suggestions: YoutubeSearchResult[] = await this.buildLlmSuggestions(seedTrack, state);
    const seedVideoId = extractVideoIdFromUrl(seedTrack.url);

    if (seedVideoId && this.youtubeService.searchRelatedSuggestions) {
      try {
        const related = await this.youtubeService.searchRelatedSuggestions(
          seedVideoId,
          SUGGESTION_FETCH_LIMIT
        );
        suggestions.push(...related);
      } catch (error) {
        console.error("Related suggestion fetch failed:", error);
      }
    }

    if (suggestions.length < SUGGESTION_FETCH_LIMIT) {
      try {
        const fallback = await this.youtubeService.searchSuggestions(
          seedTrack.title,
          SUGGESTION_FETCH_LIMIT
        );
        suggestions.push(...fallback);
      } catch (error) {
        console.error("Fallback suggestion fetch failed:", error);
      }
    }

    const deduped = this.dedupeSuggestionsByVideoId(suggestions);
    const filtered = this.filterSuggestionVariants(seedTrack, deduped);
    const artistBalanced = this.balanceArtistDiversity(filtered, SUGGESTION_LIMIT);

    if (artistBalanced.length > 0) {
      return artistBalanced;
    }

    const looseFallback = deduped
      .filter((suggestion) => suggestion.videoId !== seedVideoId)
      .slice(0, SUGGESTION_LIMIT);

    if (looseFallback.length > 0) {
      return looseFallback;
    }

    return [];
  }

  private dedupeSuggestionsByVideoId(
    suggestions: YoutubeSearchResult[]
  ): YoutubeSearchResult[] {
    const seenVideoIds = new Set<string>();
    const deduped: YoutubeSearchResult[] = [];

    for (const suggestion of suggestions) {
      if (seenVideoIds.has(suggestion.videoId)) {
        continue;
      }

      seenVideoIds.add(suggestion.videoId);
      deduped.push(suggestion);
    }

    return deduped;
  }

  private filterSuggestionVariants(
    seedTrack: Track,
    suggestions: YoutubeSearchResult[]
  ): YoutubeSearchResult[] {
    const seedVideoId = extractVideoIdFromUrl(seedTrack.url);
    const seenCanonicalTitles = new Set<string>();
    const filtered: YoutubeSearchResult[] = [];

    for (const suggestion of suggestions) {
      if (suggestion.videoId === seedVideoId) {
        continue;
      }

      if (isLikelySameSong(seedTrack.title, suggestion.title)) {
        continue;
      }

      const canonicalTitle = canonicalSuggestionKey(suggestion.title);
      if (canonicalTitle.length > 0 && seenCanonicalTitles.has(canonicalTitle)) {
        continue;
      }

      if (canonicalTitle.length > 0) {
        seenCanonicalTitles.add(canonicalTitle);
      }

      filtered.push(suggestion);
    }

    return filtered;
  }

  private buildLlmSuggestionPrompt(seedTrack: Track, state: GuildQueueState): string {
    const historyLines = state.history
      .slice(-5)
      .reverse()
      .map((track) => `- ${track.title} | ${track.channelTitle}`);
    const queueLines = state.queue
      .slice(0, 5)
      .map((track) => `- ${track.title} | ${track.channelTitle}`);

    return [
      "You are a music recommendation planner for a Discord DJ bot.",
      "Create diverse follow-up songs for the current listening mood.",
      "",
      "Output format rules:",
      '- Return strict JSON only: {"queries":["song artist", "..."]}',
      `- Return exactly ${LLM_SUGGESTION_QUERY_LIMIT} short search queries`,
      "- No markdown, no prose, no explanation",
      "- Avoid duplicates, covers, remixes, and alternate versions of the same song",
      "- Prefer different artists and adjacent vibe/genre",
      "",
      "Current track:",
      `- ${seedTrack.title} | ${seedTrack.channelTitle}`,
      "",
      "Recent history:",
      ...(historyLines.length > 0 ? historyLines : ["- none"]),
      "",
      "Upcoming queue:",
      ...(queueLines.length > 0 ? queueLines : ["- none"])
    ].join("\n");
  }

  private async buildLlmSuggestions(
    seedTrack: Track,
    state: GuildQueueState
  ): Promise<YoutubeSearchResult[]> {
    try {
      const llmResponse = await this.geminiService.generateReply(
        this.buildLlmSuggestionPrompt(seedTrack, state)
      );
      const queries = parseGeminiSuggestionQueries(llmResponse);
      if (queries.length === 0) {
        return [];
      }

      const results = await Promise.all(
        queries.map(async (query) => {
          try {
            return await this.youtubeService.searchTopVideo(query, "music");
          } catch (error) {
            console.error(`LLM query lookup failed for "${query}":`, error);
            return null;
          }
        })
      );

      return results.filter(
        (entry): entry is YoutubeSearchResult => entry !== null
      );
    } catch (error) {
      console.error("LLM suggestion generation failed:", error);
      return [];
    }
  }

  private balanceArtistDiversity(
    suggestions: YoutubeSearchResult[],
    limit: number
  ): YoutubeSearchResult[] {
    const selected: YoutubeSearchResult[] = [];
    const artistCounts = new Map<string, number>();

    const tryAddWithCap = (maxPerArtist: number): void => {
      for (const suggestion of suggestions) {
        if (selected.length >= limit) {
          return;
        }

        if (selected.some((entry) => entry.videoId === suggestion.videoId)) {
          continue;
        }

        const artist = normalizeArtistName(suggestion.channelTitle) || "unknown";
        const count = artistCounts.get(artist) ?? 0;

        if (count >= maxPerArtist) {
          continue;
        }

        selected.push(suggestion);
        artistCounts.set(artist, count + 1);
      }
    };

    tryAddWithCap(1);
    if (selected.length < limit) {
      tryAddWithCap(2);
    }

    if (selected.length < limit) {
      for (const suggestion of suggestions) {
        if (selected.length >= limit) {
          break;
        }
        if (selected.some((entry) => entry.videoId === suggestion.videoId)) {
          continue;
        }
        selected.push(suggestion);
      }
    }

    return selected;
  }

  private async fetchMessage(
    channel: GuildTextBasedChannel,
    messageId: string
  ): Promise<Message | null> {
    try {
      return await channel.messages.fetch(messageId);
    } catch {
      return null;
    }
  }
}
