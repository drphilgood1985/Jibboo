import "dotenv/config";
import { loadEnv } from "../config/env.js";
import { registerGuildCommands } from "./registerGuildCommands.js";

async function runRegisterCommands(): Promise<void> {
  const env = loadEnv();
  const count = await registerGuildCommands(env);
  console.log(`Registered ${count} guild commands.`);
}

runRegisterCommands().catch((error) => {
  console.error("Failed to register commands:", error);
  process.exitCode = 1;
});
