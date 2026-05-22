import { describe, expect, it } from "vitest";
import { getGuildCommandPayload } from "../src/discord/commandRegistry.js";

describe("command registration", () => {
  it("includes core command payload", () => {
    const payload = getGuildCommandPayload();
    const commandNames = payload.map((command) => command.name);

    expect(commandNames).toContain("play");
    expect(commandNames).toContain("video");
    expect(commandNames).toContain("playnext");
    expect(commandNames).toContain("suno");
    expect(commandNames).toContain("sunonext");
    expect(commandNames).toContain("playlist");
    expect(commandNames).toContain("stop");
    expect(commandNames).toContain("remove");
    expect(commandNames).toContain("jibboo");
    expect(commandNames).toContain("howdo");
  });
});
