import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Auth } from "../src/main/auth";
import type { Store } from "../src/main/store";
const response = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200 });
function fakeStore() {
  return {
    secrets: {
      googleClientId: "test.apps.googleusercontent.com",
      googleClientSecret: "test-desktop-secret",
      twitchClientId: "test-client-id",
    },
    saveSecrets() {},
  } as Store;
}
test("Google desktop OAuth rejects wrong state and exchanges a valid callback with PKCE", async () => {
  const store = fakeStore(),
    original = globalThis.fetch;
  let challenge = "",
    redirect = "",
    exchanges = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("http://127.0.0.1:"))
      return original(input, init);
    assert.equal(String(input), "https://oauth2.googleapis.com/token");
    const body = init?.body as URLSearchParams;
    assert.equal(body.get("code"), "test-auth-code");
    assert.equal(body.get("redirect_uri"), redirect);
    assert.equal(
      createHash("sha256")
        .update(body.get("code_verifier")!)
        .digest("base64url"),
      challenge,
    );
    exchanges++;
    return response({
      access_token: "test-access",
      refresh_token: "test-refresh",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/youtube.readonly",
    });
  };
  try {
    const auth = new Auth(store, async (url) => {
      const params = new URL(url).searchParams;
      challenge = params.get("code_challenge")!;
      redirect = params.get("redirect_uri")!;
      assert.equal(params.get("code_challenge_method"), "S256");
      assert.equal(
        params.get("scope"),
        "https://www.googleapis.com/auth/youtube.readonly",
      );
      const rejected = await original(redirect + "?state=wrong&code=bad");
      assert.equal(rejected.status, 400);
      assert.equal(exchanges, 0);
      const accepted = await original(
        redirect +
          "?" +
          new URLSearchParams({
            state: params.get("state")!,
            code: "test-auth-code",
          }),
      );
      assert.equal(accepted.status, 200);
    });
    await auth.youtube(new AbortController().signal);
    assert.equal(exchanges, 1);
    assert.equal(store.secrets.youtube?.access_token, "test-access");
    await assert.rejects(original(redirect));
  } finally {
    globalThis.fetch = original;
  }
});
test("cancelling Google OAuth closes callback and does not save authorization", async () => {
  const store = fakeStore(),
    controller = new AbortController();
  let callback = "";
  const auth = new Auth(store, async (url) => {
    callback = new URL(url).searchParams.get("redirect_uri")!;
    controller.abort();
  });
  await assert.rejects(auth.youtube(controller.signal), /cancelled/);
  assert.equal(store.secrets.youtube, undefined);
  await assert.rejects(fetch(callback));
});
test("concurrent token refresh rotates once and Forget during refresh cannot restore tokens", async () => {
  const original = globalThis.fetch,
    store = fakeStore();
  let requests = 0;
  store.secrets.twitch = {
    access_token: "old-access",
    refresh_token: "old-refresh",
    expiresAt: 0,
  };
  globalThis.fetch = async () => {
    requests++;
    await new Promise((r) => setTimeout(r, 20));
    return response({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
    });
  };
  try {
    const auth = new Auth(store, async () => {});
    assert.deepEqual(
      await Promise.all([auth.token("twitch"), auth.token("twitch")]),
      ["new-access", "new-access"],
    );
    assert.equal(requests, 1);
    assert.equal(store.secrets.twitch?.refresh_token, "new-refresh");
    const pending = auth.token("twitch", true);
    delete store.secrets.twitch;
    await assert.rejects(pending, /cancelled/);
    assert.equal(store.secrets.twitch, undefined);
  } finally {
    globalThis.fetch = original;
  }
});
test("Twitch public-client device flow requests only read access without a client secret", async () => {
  const original = globalThis.fetch,
    store = fakeStore();
  let opened = false;
  globalThis.fetch = async (input, init) => {
    const body = init?.body as URLSearchParams;
    assert.equal(body.get("scopes"), "user:read:chat");
    assert.equal(body.has("client_secret"), false);
    if (String(input).endsWith("/device"))
      return response({
        verification_uri: "https://www.twitch.tv/activate?device-code=TEST",
        user_code: "TEST",
        device_code: "private-device-code",
        interval: 5,
        expires_in: 60,
      });
    assert.equal(
      body.get("grant_type"),
      "urn:ietf:params:oauth:grant-type:device_code",
    );
    assert.equal(body.get("device_code"), "private-device-code");
    return response({
      access_token: "test-access",
      refresh_token: "test-refresh",
      expires_in: 14400,
    });
  };
  try {
    const auth = new Auth(store, async (url) => {
      assert.equal(new URL(url).hostname, "www.twitch.tv");
      opened = true;
    });
    await auth.twitch(new AbortController().signal, () => {});
    assert.equal(opened, true);
    assert.equal(store.secrets.twitch?.access_token, "test-access");
  } finally {
    globalThis.fetch = original;
  }
});
