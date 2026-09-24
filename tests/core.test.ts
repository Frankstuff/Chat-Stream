import { test } from "node:test";
import assert from "node:assert/strict";
import { Feed, videoId, settingsPatch } from "../src/main/core";
import { loadSync } from "@grpc/proto-loader";
import { join } from "node:path";
test("combined feed sorts late arrivals, deduplicates per platform, and stays bounded", () => {
  const feed = new Feed();
  for (const [id, platform, timestamp] of [
    ["a", "twitch", 30],
    ["b", "youtube", 10],
    ["a", "youtube", 20],
  ] as const)
    feed.add({ id, platform, timestamp, username: "test", text: "hello" });
  assert.deepEqual(
    feed.messages.map((m) => m.timestamp),
    [10, 20, 30],
  );
  assert.equal(
    feed.add({
      id: "a",
      platform: "twitch",
      timestamp: 40,
      username: "test",
      text: "duplicate",
    }),
    false,
  );
  for (let i = 0; i < 600; i++)
    feed.add({
      id: String(i),
      platform: "twitch",
      timestamp: 100 + i,
      username: "test",
      text: "hello",
    });
  assert.equal(feed.messages.length, 500);
  assert.equal(feed.messages[0].timestamp, 200);
});
test("YouTube URL parser accepts direct video forms and rejects lookalike hosts", () => {
  for (const input of [
    "abcdefghijk",
    "https://youtu.be/abcdefghijk?t=12",
    "https://www.youtube.com/watch?v=abcdefghijk",
    "https://youtube.com/live/abcdefghijk?si=x",
  ])
    assert.equal(videoId(input), "abcdefghijk");
  for (const input of [
    "https://youtube.com.evil.test/watch?v=abcdefghijk",
    "https://youtube.com/@someone/live",
    "file:///abcdefghijk",
    "garbage",
  ])
    assert.throws(() => videoId(input));
});
test("settings validation clamps visible opacity and font sizes and rejects wrong types", () => {
  assert.deepEqual(
    settingsPatch({
      opacity: 0,
      fontSize: 999,
      clickThrough: true,
      soundEnabled: false,
      unexpected: "ignored",
    }),
    { opacity: 0.2, fontSize: 32, clickThrough: true, soundEnabled: false },
  );
  assert.throws(() => settingsPatch({ opacity: NaN }));
  assert.throws(() => settingsPatch({ alwaysOnTop: "true" }));
  assert.throws(() => settingsPatch({ soundEnabled: "false" }));
});
test("official protobuf decodes streaming author details, text, and resume tokens", () => {
  const def = loadSync(join(process.cwd(), "assets/stream_list.proto"), {
    keepCase: false,
    longs: String,
    enums: String,
  });
  const service = def["youtube.api.v3.V3DataLiveChatMessageService"] as any;
  assert.equal(service.StreamList.responseStream, true);
  const response = {
    nextPageToken: "resume",
    items: [
      {
        id: "one",
        snippet: {
          displayMessage: "Hello 👋",
          publishedAt: "2026-09-23T12:00:00Z",
        },
        authorDetails: { displayName: "Maya" },
      },
    ],
  };
  assert.deepEqual(
    service.StreamList.responseDeserialize(
      service.StreamList.responseSerialize(response),
    ),
    response,
  );
});
