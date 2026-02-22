import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { howdoCommand } from "../commands/howdo.js";
import { jibbooCommand } from "../commands/jibboo.js";
import { nextCommand } from "../commands/next.js";
import { nowplayingCommand } from "../commands/nowplaying.js";
import { playCommand } from "../commands/play.js";
import { playnextCommand } from "../commands/playnext.js";
import { previousCommand } from "../commands/previous.js";
import { videoCommand } from "../commands/video.js";
import { volumeCommand } from "../commands/volume.js";
import type { AppCommand } from "../types/appCommand.js";

export const commandRegistry: AppCommand[] = [
  playCommand,
  videoCommand,
  playnextCommand,
  nextCommand,
  previousCommand,
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
