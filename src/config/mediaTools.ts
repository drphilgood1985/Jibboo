import { accessSync, constants as fsConstants } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpegStaticPath = require("ffmpeg-static") as string | null;
const { YOUTUBE_DL_PATH } = require("youtube-dl-exec/src/constants") as {
  YOUTUBE_DL_PATH?: string;
};

function executableExists(path: string | null | undefined): path is string {
  if (!path) {
    return false;
  }

  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutable(
  envKey: string,
  bundledPath: string | null | undefined,
  fallbackCommand: string
): string {
  const envPath = process.env[envKey];
  if (executableExists(envPath)) {
    return envPath;
  }

  if (executableExists(bundledPath)) {
    return bundledPath;
  }

  return fallbackCommand;
}

export const YTDLP_EXECUTABLE = resolveExecutable(
  "YTDLP_PATH",
  YOUTUBE_DL_PATH,
  "yt-dlp"
);

export const FFMPEG_EXECUTABLE = resolveExecutable(
  "FFMPEG_PATH",
  ffmpegStaticPath,
  "ffmpeg"
);

export function buildYtdlpArgs(
  args: readonly string[],
  options: { includeFfmpegLocation?: boolean } = {}
): string[] {
  return [
    "--js-runtimes",
    "node",
    ...(options.includeFfmpegLocation && FFMPEG_EXECUTABLE !== "ffmpeg"
      ? ["--ffmpeg-location", FFMPEG_EXECUTABLE]
      : []),
    ...args
  ];
}
