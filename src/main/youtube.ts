import * as grpc from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import type { Auth } from "./auth";
import type { ChatMessage, Connection } from "../shared";
import { ApiError, delay, jsonRequest, videoId } from "./core";
export class YouTube {
  constructor(
    private auth: Auth,
    private message: (m: ChatMessage) => void,
    private status: (s: Connection) => void,
    private protoPath: string,
    private transport = {
      address: "youtube.googleapis.com:443",
      credentials: grpc.credentials.createSsl(),
    },
  ) {}
  private async api(
    path: string,
    params: Record<string, string>,
    signal: AbortSignal,
  ) {
    const url =
      "https://www.googleapis.com/youtube/v3/" +
      path +
      "?" +
      new URLSearchParams(params);
    try {
      return await jsonRequest(url, {
        headers: {
          Authorization: `Bearer ${await this.auth.token("youtube")}`,
        },
        signal,
      });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      return jsonRequest(url, {
        headers: {
          Authorization: `Bearer ${await this.auth.token("youtube", true)}`,
        },
        signal,
      });
    }
  }
  async run(signal: AbortSignal, url: string) {
    let chatId = "",
      title = "",
      pageToken = "",
      attempt = 0;
    // Validate input once, before the retry loop.
    const id = url ? videoId(url) : "";
    while (!signal.aborted) {
      try {
        if (!chatId) {
          this.status({
            state: "connecting",
            detail: id
              ? "Finding livestream chat…"
              : "Finding your active YouTube broadcast…",
          });
          if (id) {
            const data = await this.api(
                "videos",
                { part: "liveStreamingDetails,snippet", id },
                signal,
              ),
              video = data.items?.[0];
            chatId = video?.liveStreamingDetails?.activeLiveChatId || "";
            title = video?.snippet?.title || "YouTube";
            if (!chatId && video?.liveStreamingDetails?.actualEndTime) {
              this.status({
                state: "ended",
                detail:
                  "This YouTube livestream has ended. Paste your next livestream URL and connect again.",
              });
              return;
            }
            if (!chatId) {
              this.status({
                state: "waiting",
                detail:
                  "No active chat at this URL. Waiting for the stream to start (checking every 60s).",
              });
              await delay(60000, signal);
              continue;
            }
          } else {
            const data = await this.api(
              "liveBroadcasts",
              {
                part: "snippet,status",
                broadcastStatus: "active",
                broadcastType: "all",
                maxResults: "50",
              },
              signal,
            );
            if (data.items?.length > 1)
              throw new Error(
                "Multiple active broadcasts found. Paste the livestream URL to select one.",
              );
            const broadcast = data.items?.[0];
            chatId = broadcast?.snippet?.liveChatId || "";
            title = broadcast?.snippet?.title || "YouTube";
            if (!chatId) {
              this.status({
                state: "waiting",
                detail:
                  "No active broadcast found. Start streaming or paste a livestream URL. Checking every 60s.",
              });
              await delay(60000, signal);
              continue;
            }
          }
        }
        const token = await this.auth.token("youtube");
        signal.throwIfAborted();
        const definition = loadSync(this.protoPath, {
          keepCase: false,
          longs: String,
          enums: String,
          defaults: false,
        });
        const api = grpc.loadPackageDefinition(definition) as any;
        const client = new api.youtube.api.v3.V3DataLiveChatMessageService(
          this.transport.address,
          this.transport.credentials,
        );
        try {
          await new Promise<void>((resolve, reject) => {
            const metadata = new grpc.Metadata();
            metadata.set("authorization", `Bearer ${token}`);
            const stream = client.StreamList(
              {
                liveChatId: chatId,
                part: ["id", "snippet", "authorDetails"],
                maxResults: 200,
                ...(pageToken ? { pageToken } : {}),
              },
              metadata,
              { deadline: Date.now() + 50 * 60 * 1000 },
            ) as grpc.ClientReadableStream<any>;
            let settled = false;
            const finish = (error?: Error) => {
              if (settled) return;
              settled = true;
              signal.removeEventListener("abort", abort);
              stream.cancel();
              error ? reject(error) : resolve();
            };
            const abort = () => finish();
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) {
              finish();
              return;
            }
            stream.on("data", (response: any) => {
              if (settled || signal.aborted) return;
              attempt = 0;
              this.status({
                state: "connected",
                detail: `${title} · streamList`,
              });
              for (const item of response.items || []) {
                const snippet = item.snippet;
                if (item.id && snippet?.displayMessage)
                  this.message({
                    id: item.id,
                    platform: "youtube",
                    username: item.authorDetails?.displayName || "YouTube",
                    text: snippet.displayMessage,
                    timestamp: Date.parse(snippet.publishedAt) || Date.now(),
                  });
              }
              if (response.nextPageToken) pageToken = response.nextPageToken;
              if (response.offlineAt) {
                this.status({
                  state: "ended",
                  detail:
                    "YouTube livestream ended. Connect again for your next stream.",
                });
                finish(new Error("STREAM_ENDED"));
              }
            });
            stream.on("error", (error: grpc.ServiceError) => finish(error));
            stream.on("end", () => finish());
          });
        } finally {
          client.close();
        }
        if (!signal.aborted) {
          this.status({
            state: "reconnecting",
            detail: "Resuming YouTube chat…",
          });
          await delay(1500, signal);
        }
      } catch (e) {
        if (signal.aborted) return;
        if (e instanceof Error && e.message === "STREAM_ENDED") return;
        const code = (e as grpc.ServiceError).code;
        if (code === grpc.status.FAILED_PRECONDITION) {
          this.status({
            state: "ended",
            detail:
              "YouTube chat has ended or is disabled. Connect again when live chat is available.",
          });
          return;
        }
        if (code === grpc.status.UNAUTHENTICATED) {
          await this.auth.token("youtube", true);
          continue;
        }
        if (code === grpc.status.PERMISSION_DENIED)
          throw new Error(
            "YouTube denied chat access. Check the selected account, read-only consent, and enabled YouTube Data API.",
          );
        if (code === grpc.status.NOT_FOUND)
          throw new Error(
            "YouTube chat was not found. Check your livestream URL.",
          );
        if (code === grpc.status.INVALID_ARGUMENT && pageToken) {
          pageToken = "";
          continue;
        }
        if (code === grpc.status.INVALID_ARGUMENT)
          throw new Error(
            "YouTube rejected the chat request. Check your livestream URL.",
          );
        if (e instanceof ApiError && [400, 401, 403, 404].includes(e.status))
          throw e;
        if (
          code === undefined &&
          !(e instanceof ApiError) &&
          !(e instanceof TypeError) &&
          !(
            e instanceof Error &&
            ["AbortError", "TimeoutError"].includes(e.name)
          )
        )
          throw e;
        this.status({
          state: "reconnecting",
          detail:
            code === grpc.status.RESOURCE_EXHAUSTED
              ? "YouTube quota or rate limit reached. Retrying in 60 seconds…"
              : "YouTube connection interrupted. Resuming automatically…",
        });
        await delay(
          code === grpc.status.RESOURCE_EXHAUSTED
            ? 60000
            : Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) +
                Math.random() * 500,
          signal,
        );
      }
    }
  }
}
