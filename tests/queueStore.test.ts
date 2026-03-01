import { describe, expect, it } from "vitest";
import { QueueStore } from "../src/core/queueStore.js";

describe("QueueStore", () => {
  it("supports /play and /playnext ordering", () => {
    const queueStore = new QueueStore();
    const guildId = "guild-1";

    queueStore.enqueue(
      guildId,
      {
        title: "Song A",
        videoId: "a",
        url: "https://www.youtube.com/watch?v=a",
        channelTitle: "Channel"
      },
      "user-1",
      "end"
    );

    queueStore.enqueue(
      guildId,
      {
        title: "Song B",
        videoId: "b",
        url: "https://www.youtube.com/watch?v=b",
        channelTitle: "Channel"
      },
      "user-1",
      "end"
    );

    queueStore.enqueue(
      guildId,
      {
        title: "Song C",
        videoId: "c",
        url: "https://www.youtube.com/watch?v=c",
        channelTitle: "Channel"
      },
      "user-1",
      "next"
    );

    const state = queueStore.getSnapshot(guildId);

    expect(state.current?.title).toBe("Song A");
    expect(state.queue.map((track) => track.title)).toEqual(["Song C", "Song B"]);
  });

  it("supports previous track restore", () => {
    const queueStore = new QueueStore();
    const guildId = "guild-1";

    queueStore.enqueue(
      guildId,
      {
        title: "Song A",
        videoId: "a",
        url: "https://www.youtube.com/watch?v=a",
        channelTitle: "Channel"
      },
      "user-1",
      "end"
    );

    queueStore.enqueue(
      guildId,
      {
        title: "Song B",
        videoId: "b",
        url: "https://www.youtube.com/watch?v=b",
        channelTitle: "Channel"
      },
      "user-1",
      "end"
    );

    queueStore.next(guildId);
    const back = queueStore.previous(guildId);

    expect(back.current?.title).toBe("Song A");
  });

  it("removes a queued track by 1-based queue position", () => {
    const queueStore = new QueueStore();
    const guildId = "guild-1";

    queueStore.enqueue(
      guildId,
      {
        title: "Song A",
        videoId: "a",
        url: "https://www.youtube.com/watch?v=a",
        channelTitle: "Channel"
      },
      "user-1",
      "end"
    );

    queueStore.enqueue(
      guildId,
      {
        title: "Song B",
        videoId: "b",
        url: "https://www.youtube.com/watch?v=b",
        channelTitle: "Channel"
      },
      "user-1",
      "end"
    );

    queueStore.enqueue(
      guildId,
      {
        title: "Song C",
        videoId: "c",
        url: "https://www.youtube.com/watch?v=c",
        channelTitle: "Channel"
      },
      "user-1",
      "end"
    );

    const result = queueStore.removeQueuedTrackAt(guildId, 2);

    expect(result.removed?.title).toBe("Song C");
    expect(result.state.current?.title).toBe("Song A");
    expect(result.state.queue.map((track) => track.title)).toEqual(["Song B"]);
  });

  it("clears queued tracks while keeping current", () => {
    const queueStore = new QueueStore();
    const guildId = "guild-1";

    queueStore.enqueue(
      guildId,
      {
        title: "Song A",
        videoId: "a",
        url: "https://www.youtube.com/watch?v=a",
        channelTitle: "Channel"
      },
      "user-1",
      "end"
    );

    queueStore.enqueue(
      guildId,
      {
        title: "Song B",
        videoId: "b",
        url: "https://www.youtube.com/watch?v=b",
        channelTitle: "Channel"
      },
      "user-1",
      "end"
    );

    const result = queueStore.clearQueue(guildId);

    expect(result.cleared).toBe(1);
    expect(result.state.current?.title).toBe("Song A");
    expect(result.state.queue).toHaveLength(0);
  });
});
