import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import * as grpc from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { join } from "node:path";
import { Twitch } from "../src/main/twitch";
import { YouTube } from "../src/main/youtube";
import { Feed } from "../src/main/core";
import type { Auth } from "../src/main/auth";
import type { Store } from "../src/main/store";
const auth = {
  token: async () => "test-token",
  validateTwitch: async () => ({ user_id: "42", login: "streamer" }),
} as unknown as Auth;
test("Twitch subscribes read-only, reconnects after dropped socket, and suppresses redelivery", async () => {
  const requests: any[] = [];
  const feed = new Feed();
  let sockets = 0;
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/users")) {
      res.end(JSON.stringify({ data: [{ id: "42" }] }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push(JSON.parse(body));
      res.writeHead(202);
      res.end(JSON.stringify({ data: [] }));
    });
  });
  const wss = new WebSocketServer({ server });
  const controller = new AbortController();
  wss.on("connection", (ws) => {
    const n = ++sockets;
    ws.send(
      JSON.stringify({
        metadata: { message_type: "session_welcome" },
        payload: {
          session: { id: `session-${n}`, keepalive_timeout_seconds: 10 },
        },
      }),
    );
    setTimeout(() => {
      const packet = {
        metadata: {
          message_type: "notification",
          message_timestamp: "2026-09-23T12:00:00Z",
        },
        payload: {
          subscription: { type: "channel.chat.message" },
          event: {
            message_id: "same-id",
            chatter_user_name: "Pixel",
            message: { text: "Hello from Twitch" },
          },
        },
      };
      ws.send(JSON.stringify(packet));
      if (n === 1) setTimeout(() => ws.close(), 40);
      else setTimeout(() => controller.abort(), 60);
    }, 80);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const watchdog = setTimeout(() => controller.abort(), 8000);
  try {
    await new Twitch(
      auth,
      {
        prefs: { twitchChannel: "" },
        secrets: { twitchClientId: "test-client" },
      } as Store,
      (m) => {
        feed.add(m);
      },
      () => {},
      {
        helix: `http://127.0.0.1:${address.port}`,
        websocket: `ws://127.0.0.1:${address.port}`,
      },
    ).run(controller.signal);
    assert.equal(sockets, 2);
    assert.equal(feed.messages.length, 1);
    assert.equal(
      requests.filter((r) => r.type === "channel.chat.message").length,
      2,
    );
    assert.deepEqual(requests[0].condition, {
      broadcaster_user_id: "42",
      user_id: "42",
    });
    assert(
      requests.every((r) =>
        ["channel.chat.message", "stream.offline", "stream.online"].includes(
          r.type,
        ),
      ),
    );
  } finally {
    clearTimeout(watchdog);
    wss.close();
    server.close();
    server.closeAllConnections();
  }
});
test("YouTube uses streamList, resumes with page token, deduplicates history, and handles stream end", async () => {
  const proto = join(process.cwd(), "assets/stream_list.proto");
  const def = loadSync(proto, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: false,
  });
  const service = (grpc.loadPackageDefinition(def) as any).youtube.api.v3
    .V3DataLiveChatMessageService.service;
  const server = new grpc.Server();
  const requests: any[] = [];
  const feed = new Feed();
  const statuses: string[] = [];
  server.addService(service, {
    StreamList(call: grpc.ServerWritableStream<any, any>) {
      requests.push(call.request);
      assert.equal(call.metadata.get("authorization")[0], "Bearer test-token");
      const item = {
        id: "yt-1",
        snippet: {
          displayMessage: "Hello from YouTube",
          publishedAt: "2026-09-23T11:59:59Z",
        },
        authorDetails: { displayName: "Maya" },
      };
      call.write({
        nextPageToken: "page-two",
        items: [item],
        ...(requests.length === 2 ? { offlineAt: "2026-09-23T12:01:00Z" } : {}),
      });
      call.end();
    },
  });
  const port = await new Promise<number>((resolve, reject) =>
    server.bindAsync(
      "127.0.0.1:0",
      grpc.ServerCredentials.createInsecure(),
      (e, p) => (e ? reject(e) : resolve(p)),
    ),
  );
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        items: [{ snippet: { title: "My live stream", liveChatId: "chat-1" } }],
      }),
      { status: 200 },
    );
  const controller = new AbortController(),
    watchdog = setTimeout(() => controller.abort(), 8000);
  try {
    await new YouTube(
      auth,
      (m) => {
        feed.add(m);
      },
      (s) => statuses.push(s.state),
      proto,
      {
        address: `127.0.0.1:${port}`,
        credentials: grpc.credentials.createInsecure(),
      },
    ).run(controller.signal, "");
    assert.equal(requests.length, 2);
    assert.equal(requests[1].pageToken, "page-two");
    assert.deepEqual(requests[0].part, ["id", "snippet", "authorDetails"]);
    assert.equal(feed.messages.length, 1);
    assert.equal(feed.messages[0].username, "Maya");
    assert.equal(statuses.at(-1), "ended");
  } finally {
    globalThis.fetch = original;
    clearTimeout(watchdog);
    controller.abort();
    server.forceShutdown();
  }
});
