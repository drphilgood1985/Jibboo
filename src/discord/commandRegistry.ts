import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { howdoCommand } from "../commands/howdo.js";
import { jibbooCommand } from "../commands/jibboo.js";
import { nextCommand } from "../commands/next.js";
import { nowplayingCommand } from "../commands/nowplaying.js";
import { playCommand } from "../commands/play.js";
import { playnextCommand } from "../commands/playnext.js";
import { playlistCommand } from "../commands/playlist.js";
import { previousCommand } from "../commands/previous.js";
import { removeCommand } from "../commands/remove.js";
import { sunoCommand, sunonextCommand } from "../commands/suno.js";
import { videoCommand } from "../commands/video.js";
import { volumeCommand } from "../commands/volume.js";
import type { AppCommand } from "../types/appCommand.js";

export const commandRegistry: AppCommand[] = [
  playCommand,
  videoCommand,
  playnextCommand,
  sunoCommand,
  sunonextCommand,
  playlistCommand,
  nextCommand,
  previousCommand,
  removeCommand,
  volumeCommand,
  nowplayingCommand,
  jibbooCommand,
  howdoCommand
];

export const commandMap = new Map(
  commandRegistry.map((command) => [command.name, command] as const)
);

export function getGuildCommandPayload(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return commandRegistry.map((command) => command.data.toJSON());
}
