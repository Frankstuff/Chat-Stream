import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import type { Store, Token } from "./store";
import type { Platform } from "../shared";
import { ApiError, delay, jsonRequest } from "./core";
const scope = "https://www.googleapis.com/auth/youtube.readonly";
export class Auth {
  private refreshing = new Map<Platform, Promise<string>>();
  constructor(
    private store: Store,
    private openBrowser: (url: string) => Promise<void>,
  ) {}
  private save(platform: Platform, data: any) {
    if (typeof data.access_token !== "string")
      throw new Error("Authorization did not return an access token.");
    const token: Token = {
      access_token: data.access_token,
      refresh_token:
        data.refresh_token || this.store.secrets[platform]?.refresh_token,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    };
    this.store.secrets[platform] = token;
    this.store.saveSecrets();
    return token.access_token;
  }
  async token(platform: Platform, force = false): Promise<string> {
    const token = this.store.secrets[platform];
    if (!token) throw new Error("Authorize your account with Connect.");
    if (!force && token.expiresAt > Date.now() + 120000)
      return token.access_token;
    const existing = this.refreshing.get(platform);
    if (existing) return existing;
    const pending = (async () => {
      if (!token.refresh_token)
        throw new Error("Session expired. Forget account and connect again.");
      const s = this.store.secrets;
      try {
        const data = await jsonRequest(
          platform === "twitch"
            ? "https://id.twitch.tv/oauth2/token"
            : "https://oauth2.googleapis.com/token",
          {
            method: "POST",
            body: new URLSearchParams({
              client_id: (platform === "twitch"
                ? s.twitchClientId
                : s.googleClientId)!,
              ...(platform === "youtube"
                ? { client_secret: s.googleClientSecret! }
                : {}),
              grant_type: "refresh_token",
              refresh_token: token.refresh_token,
            }),
          },
        );
        // A concurrent Forget must never resurrect a credential.
        if (this.store.secrets[platform] !== token)
          throw new Error("Authorization cancelled.");
        return this.save(platform, data);
      } catch (e) {
        if (e instanceof ApiError && [400, 401].includes(e.status))
          throw new Error(
            "Account authorization expired or was revoked. Forget account, then Connect again.",
          );
        throw e;
      }
    })();
    this.refreshing.set(platform, pending);
    try {
      return await pending;
    } finally {
      this.refreshing.delete(platform);
    }
  }
  async validateTwitch() {
    let token = await this.token("twitch");
    let data: any;
    try {
      data = await jsonRequest("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: `OAuth ${token}` },
      });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      token = await this.token("twitch", true);
      data = await jsonRequest("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: `OAuth ${token}` },
      });
    }
    if (
      data.client_id !== this.store.secrets.twitchClientId ||
      !data.scopes?.includes("user:read:chat")
    )
      throw new Error(
        "Twitch needs user:read:chat authorization. Forget account and reconnect.",
      );
    return data as { user_id: string; login: string };
  }
  async twitch(signal: AbortSignal, notice: (text: string) => void) {
    const client_id = this.store.secrets.twitchClientId;
    if (!client_id)
      throw new Error("Save a Twitch public application Client ID first.");
    const data = await jsonRequest("https://id.twitch.tv/oauth2/device", {
      method: "POST",
      body: new URLSearchParams({ client_id, scopes: "user:read:chat" }),
      signal,
    });
    notice(
      `In your browser, enter code ${data.user_code} and authorize read-only chat. Waiting…`,
    );
    const url = new URL(data.verification_uri);
    if (url.protocol !== "https:" || url.hostname !== "www.twitch.tv")
      throw new Error("Unexpected Twitch authorization URL.");
    await this.openBrowser(url.toString());
    const until = Date.now() + data.expires_in * 1000;
    let interval = Math.max(5, data.interval || 5) * 1000;
    while (Date.now() < until) {
      await delay(interval, signal);
      try {
        const tokens = await jsonRequest("https://id.twitch.tv/oauth2/token", {
          method: "POST",
          signal,
          body: new URLSearchParams({
            client_id,
            device_code: data.device_code,
            scopes: "user:read:chat",
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        });
        signal.throwIfAborted();
        this.save("twitch", tokens);
        return;
      } catch (e) {
        if (e instanceof ApiError && e.reason === "authorization_pending")
          continue;
        if (e instanceof ApiError && e.reason === "slow_down") {
          interval += 5000;
          continue;
        }
        throw e;
      }
    }
    throw new Error(
      "Twitch authorization timed out. Click Connect to try again.",
    );
  }
  async youtube(signal: AbortSignal) {
    const { googleClientId, googleClientSecret } = this.store.secrets;
    if (!googleClientId || !googleClientSecret)
      throw new Error("Import your Google Desktop OAuth client JSON first.");
    const state = randomBytes(32).toString("hex"),
      verifier = randomBytes(48).toString("base64url");
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Could not open local authorization callback.");
    const redirect = `http://127.0.0.1:${address.port}/callback`;
    let timer: NodeJS.Timeout | undefined;
    let abort: () => void = () => {};
    try {
      const codePromise = new Promise<string>((resolve, reject) => {
        abort = () => reject(new Error("Authorization cancelled."));
        signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(
          () =>
            reject(
              new Error("Google authorization timed out. Click Connect again."),
            ),
          180000,
        );
        server.on("request", (req, res) => {
          const url = new URL(req.url || "/", redirect);
          res.setHeader("Content-Type", "text/plain");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Content-Security-Policy", "default-src 'none'");
          if (
            req.method !== "GET" ||
            url.pathname !== "/callback" ||
            url.searchParams.get("state") !== state
          ) {
            res.writeHead(400);
            res.end("Invalid authorization callback.");
            return;
          }
          if (url.searchParams.has("error")) {
            res.end("Authorization declined. Return to Chat Stream.");
            reject(new Error("Google authorization was declined."));
            return;
          }
          const code = url.searchParams.get("code");
          if (!code) {
            res.writeHead(400);
            res.end("Missing code.");
            return;
          }
          res.end(
            "Authorization received. You can close this tab and return to Chat Stream.",
          );
          resolve(code);
        });
      });
      // Attach a handler before opening the external browser to avoid abandoned rejections.
      void codePromise.catch(() => {});
      signal.throwIfAborted();
      await this.openBrowser(
        "https://accounts.google.com/o/oauth2/v2/auth?" +
          new URLSearchParams({
            client_id: googleClientId,
            redirect_uri: redirect,
            response_type: "code",
            scope,
            state,
            code_challenge: createHash("sha256")
              .update(verifier)
              .digest("base64url"),
            code_challenge_method: "S256",
            access_type: "offline",
            prompt: "consent",
          }),
      );
      const code = await codePromise;
      const tokens = await jsonRequest("https://oauth2.googleapis.com/token", {
        method: "POST",
        signal,
        body: new URLSearchParams({
          client_id: googleClientId,
          client_secret: googleClientSecret,
          code,
          code_verifier: verifier,
          redirect_uri: redirect,
          grant_type: "authorization_code",
        }),
      });
      signal.throwIfAborted();
      if (
        typeof tokens.scope === "string" &&
        !tokens.scope.split(" ").includes(scope)
      )
        throw new Error(
          "YouTube read-only access was not granted. Connect again and approve that permission.",
        );
      this.save("youtube", tokens);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      server.close();
      server.closeAllConnections();
    }
  }
}
