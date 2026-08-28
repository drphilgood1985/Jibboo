const DEFAULT_QUEUE_LIMIT = 50;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_NO_LISTENER_GRACE_SECONDS = 15;
const DEFAULT_WATCH_TOGETHER_APPLICATION_ID = "880218394199220334";
const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

function readRequired(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function parseQueueLimit(value: string | undefined): number {
  if (!value) {
    return DEFAULT_QUEUE_LIMIT;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error("QUEUE_LIMIT must be a positive integer");
  }

  return parsed;
}

function parsePositiveInt(
  key: string,
  value: string | undefined,
  fallback: number
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }

  return parsed;
}

function parseOptional(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function parseSnowflake(key: string, value: string): string {
  if (!DISCORD_SNOWFLAKE_PATTERN.test(value)) {
    throw new Error(`${key} must be a numeric Discord ID`);
  }

  return value;
}

function parseSnowflakeList(key: string, value: string | undefined): string[] {
  const ids = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (!ids || ids.length === 0) {
    return [];
  }

  return ids.map((id) => parseSnowflake(key, id));
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

export interface AppEnv {
  discordToken: string;
  discordClientId: string;
  discordGuildId: string;
  controlChannelId: string;
  postChannelId: string;
  commandChannelIds: string[];
  youtubeApiKey: string;
  geminiApiKey: string;
  geminiModel: string;
  watchTogetherApplicationId: string;
  queueLimit: number;
  noListenerGraceSeconds: number;
}

export function loadEnv(): AppEnv {
  const discordClientId = parseSnowflake(
    "DISCORD_CLIENT_ID",
    readRequired("DISCORD_CLIENT_ID")
  );
  const discordGuildId = parseSnowflake(
    "DISCORD_GUILD_ID",
    readRequired("DISCORD_GUILD_ID")
  );
  const controlChannelId = parseSnowflake(
    "CONTROL_CHANNEL_ID",
    readRequired("CONTROL_CHANNEL_ID")
  );
  const postChannelId = parseSnowflake(
    "POST_CHANNEL_ID",
    parseOptional(process.env.POST_CHANNEL_ID, controlChannelId)
  );
  const configuredCommandChannelIds = parseSnowflakeList(
    "MONITOR_CHANNEL_IDS",
    process.env.MONITOR_CHANNEL_IDS
  );
  const commandChannelIds = uniqueIds(
    configuredCommandChannelIds.length > 0
      ? configuredCommandChannelIds
      : [controlChannelId, postChannelId]
  );

  return {
    discordToken: readRequired("DISCORD_TOKEN"),
    discordClientId,
    discordGuildId,
    controlChannelId,
    postChannelId,
    commandChannelIds,
    youtubeApiKey: readRequired("YOUTUBE_API_KEY"),
    geminiApiKey: readRequired("GEMINI_API_KEY"),
    geminiModel: parseOptional(process.env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL),
    watchTogetherApplicationId: parseSnowflake(
      "WATCH_TOGETHER_APPLICATION_ID",
      parseOptional(
        process.env.WATCH_TOGETHER_APPLICATION_ID,
        DEFAULT_WATCH_TOGETHER_APPLICATION_ID
      )
    ),
    queueLimit: parseQueueLimit(process.env.QUEUE_LIMIT),
    noListenerGraceSeconds: parsePositiveInt(
      "NO_LISTENER_GRACE_SECONDS",
      process.env.NO_LISTENER_GRACE_SECONDS,
      DEFAULT_NO_LISTENER_GRACE_SECONDS
    )
  };
}
