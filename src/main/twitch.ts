import WebSocket from "ws";
import type { Auth } from "./auth";
import type { Store } from "./store";
import type { ChatMessage, Connection } from "../shared";
import { ApiError, delay, jsonRequest } from "./core";
export class Twitch {
  constructor(
    private auth: Auth,
    private store: Store,
    private message: (m: ChatMessage) => void,
    private status: (s: Connection) => void,
    private endpoints = {
      helix: "https://api.twitch.tv/helix",
      websocket: "wss://eventsub.wss.twitch.tv/ws",
    },
  ) {}
  async run(signal: AbortSignal) {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        this.status({
          state: attempt ? "reconnecting" : "connecting",
          detail: attempt
            ? "Reconnecting to Twitch…"
            : "Opening Twitch EventSub…",
        });
        const user = await this.auth.validateTwitch();
        signal.throwIfAborted();
        const login = this.store.prefs.twitchChannel || user.login;
        const token = await this.auth.token("twitch");
        const users = await jsonRequest(
          this.endpoints.helix + "/users?" + new URLSearchParams({ login }),
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Client-Id": this.store.secrets.twitchClientId!,
            },
            signal,
          },
        );
        if (!users.data?.[0])
          throw new Error("Twitch channel not found. Check the channel login.");
        await this.session(
          signal,
          users.data[0].id,
          user.user_id,
          login,
          () => {
            attempt = 0;
          },
        );
      } catch (e) {
        if (signal.aborted) return;
        if (
          !(e instanceof ApiError) &&
          !(e instanceof TypeError) &&
          e instanceof Error &&
          !["AbortError", "TimeoutError"].includes(e.name) &&
          !["Network connection lost.", "fetch failed"].includes(e.message)
        ) {
          throw e;
        }
        if (e instanceof ApiError && [400, 401, 403, 404].includes(e.status))
          throw e;
        this.status({
          state: "reconnecting",
          detail: "Twitch connection interrupted. Retrying automatically…",
        });
        await delay(
          Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) +
            Math.random() * 500,
          signal,
        );
      }
    }
  }
  private session(
    signal: AbortSignal,
    broadcaster: string,
    user: string,
    login: string,
    onReady: () => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const sockets = new Set<WebSocket>();
      let active: WebSocket | undefined;
      let done = false;
      let validation: NodeJS.Timeout;
      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        clearInterval(validation);
        signal.removeEventListener("abort", abort);
        for (const ws of sockets) ws.terminate();
        error ? reject(error) : resolve();
      };
      const abort = () => finish();
      signal.addEventListener("abort", abort, { once: true });
      validation = setInterval(
        () => {
          void this.auth.validateTwitch().catch((e) => finish(e));
        },
        55 * 60 * 1000,
      );
      const open = (url: string, migration = false) => {
        const ws = new WebSocket(url);
        sockets.add(ws);
        let welcomed = false;
        let watchdog: NodeJS.Timeout;
        const arm = (ms: number) => {
          clearTimeout(watchdog);
          watchdog = setTimeout(
            () => finish(new Error("Network connection lost.")),
            ms,
          );
        };
        let timeout = 15000;
        arm(timeout);
        ws.on("message", (raw) => {
          void (async () => {
            const packet = JSON.parse(raw.toString()),
              kind = packet.metadata?.message_type;
            arm(timeout);
            if (kind === "session_welcome") {
              welcomed = true;
              timeout =
                (packet.payload.session.keepalive_timeout_seconds || 10) *
                  1000 +
                5000;
              arm(timeout);
              const old = active;
              active = ws;
              if (old && old !== ws) old.close();
              if (!migration) {
                const token = await this.auth.token("twitch");
                for (const type of [
                  "channel.chat.message",
                  "stream.offline",
                  "stream.online",
                ]) {
                  await jsonRequest(
                    this.endpoints.helix + "/eventsub/subscriptions",
                    {
                      method: "POST",
                      signal,
                      headers: {
                        Authorization: `Bearer ${token}`,
                        "Client-Id": this.store.secrets.twitchClientId!,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        type,
                        version: "1",
                        condition:
                          type === "channel.chat.message"
                            ? {
                                broadcaster_user_id: broadcaster,
                                user_id: user,
                              }
                            : { broadcaster_user_id: broadcaster },
                        transport: {
                          method: "websocket",
                          session_id: packet.payload.session.id,
                        },
                      }),
                    },
                  );
                }
              }
              if (!done) {
                onReady();
                this.status({
                  state: "connected",
                  detail: `Reading ${login} · EventSub`,
                });
              }
            } else if (kind === "session_reconnect") {
              const next = new URL(packet.payload.session.reconnect_url);
              if (
                next.protocol !== "wss:" ||
                next.hostname !== "eventsub.wss.twitch.tv"
              )
                throw new Error("Unexpected Twitch reconnect URL.");
              this.status({
                state: "reconnecting",
                detail: "Twitch is moving the connection…",
              });
              open(next.toString(), true);
            } else if (kind === "revocation")
              throw new Error(
                "Twitch subscription revoked. Forget account and connect again.",
              );
            else if (kind === "notification") {
              const event = packet.payload.event,
                type = packet.payload.subscription.type;
              if (type === "channel.chat.message")
                this.message({
                  id: event.message_id,
                  platform: "twitch",
                  username: event.chatter_user_name,
                  text: event.message.text,
                  timestamp:
                    Date.parse(packet.metadata.message_timestamp) || Date.now(),
                });
              if (type === "stream.offline")
                this.status({
                  state: "waiting",
                  detail: `${login} is offline · chat remains connected`,
                });
              if (type === "stream.online")
                this.status({
                  state: "connected",
                  detail: `Reading ${login} · EventSub`,
                });
            }
          })().catch((e) =>
            finish(
              e instanceof SyntaxError
                ? new Error("Network connection lost.")
                : e,
            ),
          );
        });
        ws.on("error", () => finish(new Error("Network connection lost.")));
        ws.on("close", () => {
          clearTimeout(watchdog);
          sockets.delete(ws);
          if (!done && (ws === active || !welcomed))
            finish(new Error("Network connection lost."));
        });
      };
      if (signal.aborted) {
        finish();
        return;
      }
      open(this.endpoints.websocket);
    });
  }
}
