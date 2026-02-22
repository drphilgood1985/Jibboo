import { REST, Routes } from "discord.js";
import type { AppEnv } from "../config/env.js";
import { getGuildCommandPayload } from "./commandRegistry.js";

export async function registerGuildCommands(env: AppEnv): Promise<number> {
  const commands = getGuildCommandPayload();
  const rest = new REST({ version: "10" }).setToken(env.discordToken);

  await rest.put(
    Routes.applicationGuildCommands(env.discordClientId, env.discordGuildId),
    { body: commands }
  );

  return commands.length;
}
