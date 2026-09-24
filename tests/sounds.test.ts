import { test } from "node:test";
import assert from "node:assert/strict";
import { Feed } from "../src/main/core";
import { MessageSounds } from "../src/main/sounds";
import type { ChatMessage } from "../src/shared";

test("new messages alert for both platforms; history, duplicates, muted messages and bursts stay quiet", () => {
  const feed = new Feed();
  const connectedAt = 10000;
  let now = connectedAt,
    enabled = true,
    plays = 0;
  const sounds = new MessageSounds(
    () => plays++,
    () => now,
  );
  const receive = (
    id: string,
    platform: ChatMessage["platform"],
    timestamp = now,
  ) => {
    const message = {
      id,
      platform,
      timestamp,
      username: "viewer",
      text: "hello",
    };
    if (feed.add(message)) sounds.notify(message, enabled, connectedAt);
  };

  receive("history", "youtube", connectedAt - 1000);
  assert.equal(plays, 0);
  receive("twitch-new", "twitch");
  assert.equal(plays, 1);
  now += 1000;
  receive("twitch-new", "twitch");
  assert.equal(plays, 1);
  receive("youtube-new", "youtube");
  assert.equal(plays, 2);
  now += 100;
  receive("burst", "twitch");
  assert.equal(plays, 2);

  enabled = false;
  now += 1000;
  receive("muted", "youtube");
  assert.equal(plays, 2);
  enabled = true;
  receive("muted", "youtube");
  assert.equal(plays, 2);
  receive("after-unmute", "twitch");
  assert.equal(plays, 3);
  assert.equal(feed.messages.length, 6);
});

test("the sound preview works without enabling message alerts and repeated clicks are grouped", () => {
  let now = 0,
    plays = 0;
  const sounds = new MessageSounds(
    () => plays++,
    () => now,
  );
  sounds.preview();
  sounds.preview();
  assert.equal(plays, 1);
  now += 1000;
  sounds.preview();
  assert.equal(plays, 2);
});
