# Chat Stream

A personal, read-only macOS Electron app that combines Twitch and YouTube livestream chat in a floating window. It runs alongside your existing FFmpeg stream. It does not use OBS, capture video, send chat, relay messages, or change streaming settings.

## Run

Requires macOS and Node.js 22 or newer.

```sh
npm ci
npm run demo   # launch immediately with simulated Twitch + YouTube messages
npm start      # launch normally; open Connections on first use
```

Dependencies are already installed in this workspace. Use the menu bar **Quit Chat Stream** command before switching between demo/development runs; only one app instance runs at a time.

To create a standalone local app:

```sh
npm run package
open "release/mac-arm64/Chat Stream.app"
```

On Intel Macs, the output folder is `release/mac` instead. You can copy the app to Applications. This is an unsigned, unnotarized build for personal local use, not a distribution installer. Node.js is not needed to run the packaged app.

## Overlay controls

- Drag the title bar to move; drag a window edge/corner to resize. Position, size, opacity, text size, and always-on-top are saved.
- **Opacity** changes the whole native window (20–100%). **Text size** changes chat text (12–32 px).
- **Sound: ON/OFF** toggles alerts for new Twitch and YouTube messages, including while the overlay is hidden. It starts on and remembers your preference. **Test sound** previews your Mac's alert sound; its volume follows macOS alert settings. Both controls are also in the menu bar. Duplicate deliveries and chat history from before connecting stay silent; messages arriving within 750 ms share one alert. Demo messages also exercise sound.
- **Always on top** keeps the overlay above ordinary windows; it is also available across macOS Spaces.
- **Click-through: ON** passes clicks through the overlay to the app underneath. **⌘⇧C** toggles it from any app. The app starts with click-through **off** so the overlay can be moved and adjusted immediately.
- **⌘⇧X** always turns click-through **off** and reveals the overlay. The menu bar chat-bubble icon has **Turn click-through OFF** as well. If another app owns that shortcut, the overlay tells you to use the menu bar. Use this to regain access to opacity, text size, or window dragging.
- **⌘⇧O** shows/hides the overlay. The minus button hides it; the menu bar keeps running and provides Show, Hide, Connections, Demo, and Quit.
- **⚙** opens Connections. **Clear** clears the in-memory feed. Scroll up to read older messages; **Jump to latest** returns to automatic scrolling.
- Demo mode disconnects live readers and clears the feed so simulated and real messages do not get mixed. Connecting an account exits demo mode. Demo mode is not persisted.

For a short, ordered account setup checklist, open [CONNECT-ACCOUNTS.md](CONNECT-ACCOUNTS.md). The app includes developer-console buttons and tracks each platform’s setup, authorization, and live-chat connection.

## Connect Twitch

You need **one Twitch public application Client ID**. You do not need a Twitch client secret, API key, or stream key.

1. Open the [Twitch developer console](https://dev.twitch.tv/console/apps), sign in, and register an application. Twitch requires a verified email and two-factor authentication.
2. Choose **Public** as the client type. Give it a unique name and an appropriate application category. If registration requires an OAuth redirect URL, add `https://localhost`; this app uses device authorization, so that URL is not used for login.
3. Copy the **Client ID** into Connections → Twitch. Optionally enter a channel login (such as `yourchannel`, not a URL); leave it blank to read the authorized user's own channel. Click **Save configuration**.
4. Click **Connect Twitch**. The default browser opens Twitch's device activation page. The connection status also displays the short activation code if you need to enter it.
5. Sign in with the account that should read chat and approve **`user:read:chat`**. Return to the app; the status changes to “Reading … · EventSub.”

The app uses [Twitch's public-client device code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow) and the official [EventSub `channel.chat.message` subscription over WebSocket](https://dev.twitch.tv/docs/chat/send-receive-messages/). It also observes stream online/offline events. Chat can remain connected when a Twitch broadcast ends; the status says it is offline. Twitch must permit the authorized account to read the target channel (a banned account may be denied).

Tokens refresh automatically, rotating the refresh token. Twitch validation runs on connection and every 55 minutes. Socket drops reconnect with backoff; Twitch-directed connection migration preserves subscriptions. Revoked authorization requires **Forget account → Connect Twitch**.

## Connect YouTube

You need a **Google OAuth client of type Desktop app**, its downloaded JSON (containing `installed.client_id` and `installed.client_secret`), and a Google account with YouTube access. No stream key or API key is required.

1. Create/select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Under APIs & Services → Library, enable **YouTube Data API v3**.
3. Configure Google Auth Platform / OAuth consent: app name, support email, and audience. For a personal project, use **External**, leave it in **Testing**, and add the Google account you will sign in with under **Test users**. Add the scope `https://www.googleapis.com/auth/youtube.readonly` under Data Access if prompted.
4. Under Clients / Credentials, create an **OAuth client ID → Desktop app** and download its JSON. A Web application client or service-account JSON will not work here.
5. In Connections, click **Import Google OAuth JSON** and choose the downloaded file. Keep that downloaded credential file outside this repository.
6. Leave Livestream URL blank to discover your active broadcast, then click **Connect YouTube**. The app opens your normal browser; choose the Google account and YouTube channel that owns the broadcast, and approve read-only YouTube access. For an app you created in Testing, Google may display an unverified-app notice.
7. Return to the app. If no broadcast is active, it checks again every 60 seconds. If multiple broadcasts are active, paste a specific livestream URL and reconnect.
8. As a fallback, paste `https://www.youtube.com/watch?v=VIDEO_ID`, `https://youtube.com/live/VIDEO_ID`, a `youtu.be` link, or an 11-character video ID. Click **Connect YouTube**. The video must expose an active live chat; channel `/@name/live` URLs are not supported.

Authorization uses Google's [desktop OAuth flow](https://developers.google.com/identity/protocols/oauth2/native-app), PKCE, random state, and a temporary callback listener bound only to `127.0.0.1` on a random port. There is no hosted backend. Authorization can be cancelled with Disconnect and times out after three minutes.

Chat uses the official [`liveChatMessages.streamList`](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/streamList) gRPC API, with `nextPageToken` resumption. There is no chat polling fallback; broadcast discovery uses the REST API. Chat being ended or disabled stops the reader with a status message. Click Connect again for your next livestream. Network failures retry with backoff; quota/rate errors wait 60 seconds. Google Testing projects can issue refresh tokens that [expire after seven days](https://developers.google.com/identity/protocols/oauth2#expiration); use Forget account and authorize again if needed.

## Privacy and storage

- OAuth tokens and developer credentials are stored in `credentials.enc` under `~/Library/Application Support/Chat Stream/`, encrypted with Electron `safeStorage` using macOS Keychain protection. Files are written with owner-only permissions. If Keychain encryption is unavailable, credential storage fails closed.
- Non-secret window preferences, channel login, and last YouTube URL are saved in `settings.json` in the same folder. Chat history exists only in memory (latest 500 messages); the app has no database or analytics.
- Disconnect cancels the reader and any pending authorization but keeps credentials for next time. Forget account deletes that platform's local tokens while retaining developer configuration. It does not revoke the provider's grant; use Twitch Connections or your Google Account's third-party access settings to revoke it there.
- To remove all local app data, quit and delete the app's Application Support folder. The original Google JSON you downloaded is a separate file under your control.
- The renderer has no Node access, is sandboxed and context isolated, cannot make network requests, and receives no saved credentials. The preload bridge exposes only state, validated actions, and state subscriptions. Navigation, extra windows, webviews, and permission requests are blocked. Chat content is escaped as text.
- No secrets are included in source, output logs, or build artifacts. Credential files, `.env` files, and `.context` artifacts are ignored by Git.

## Verification

```sh
npm run typecheck
npm test
npm run test:smoke
npm run test:click-through  # native macOS mouse events; requires Accessibility access
```

The smoke test launches the actual Electron app on macOS with a separate temporary profile. It verifies both demo platforms, renderer isolation, opacity, font size, always-on-top, native movement/resizing, enabling mouse-ignore and disabling it through the menu recovery command, hide/show, shortcut registration, and the connection screen. Screenshots and the result report are written to `.context/`. The separate `test:click-through` test posts real macOS mouse events, verifies that a separate test application below the overlay receives clicks only while click-through is enabled, then verifies menu recovery. It uses a temporary profile and requires existing macOS Accessibility permission. Quit tiling window managers before this coordinate-based native test.

OAuth tests verify Google callback state and PKCE, cancellation, serialized refresh-token rotation, and Twitch device-flow read-only scopes using mocked provider responses.

Protocol tests run against local WebSocket/HTTP and gRPC fixtures. They exercise Twitch subscription creation and reconnect, YouTube streaming and resume tokens, duplicate suppression, ended streams, mixed-feed ordering, input validation, and the official protobuf schema.

**Verified in this workspace:** macOS 15.7.3, real Electron launch, both demo feeds, and overlay controls. Saved Twitch authorization connected to EventSub, and saved Google authorization successfully discovered a live broadcast and received `streamList` responses. **Still to verify:** real viewer messages appearing in the combined overlay. Post one message from each platform's own website and confirm both labels/usernames/text appear; network interruption and a stream ending can also be checked during a test broadcast. The app itself cannot send those messages.

Messages are ordered by the platforms' timestamps, so delayed messages may be inserted above newer ones. Twitch does not replay missed chat after an ordinary disconnected socket; YouTube can resume while its continuation token remains valid. The deduplication cache retains the latest 10,000 platform/message IDs. Text is displayed literally; emote images, moderation/delete-event synchronization, and rich paid-message layouts are not implemented.

## Project layout

`src/main/` contains the Electron lifecycle, encrypted storage, OAuth flows, and platform readers. `src/preload.ts` contains the narrow IPC bridge. `src/renderer/` is plain TypeScript, HTML, and CSS. `assets/stream_list.proto` comes from Google's [streaming live chat sample](https://developers.google.com/youtube/v3/live/streaming-live-chat), with the missing Duration import added; its Apache 2.0 license is included in `assets/`.
