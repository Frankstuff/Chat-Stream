# Connect your accounts

Open Chat Stream and click **⚙ Connections**. Each platform has three steps that turn green as you finish: **Developer app → Authorize account → Read live chat**. You only create developer credentials once; the app saves them encrypted and reconnects on later launches.

You never need either platform’s stream key. You do not need to change FFmpeg.

## 1. Connect Twitch first

1. Expand **Start here: create your Twitch app** and click **Open Twitch developer console**.
2. Register an application. Use a unique name, choose **Public** client type, and add `https://localhost` if a redirect URL is required. Twitch requires verified email and two-factor authentication.
3. Copy its **Client ID** into the app. Leave Channel login empty to use your own channel. Click **Save configuration**.
4. Click **Connect Twitch**. In your browser, sign in and approve read-only chat. If Twitch asks for an activation code, it is shown in the app’s connection status.
5. Return to Chat Stream. “Reading [your channel] · EventSub” means it is connected. Twitch chat can be connected while you are offline.

Already have a public Twitch app? Start at step 3. A confidential client needs to be changed to Public for this app’s device flow; no client secret is used.

## 2. Connect YouTube

Expand **Start here: create your Google desktop client**. Use its three buttons in order, keeping the same Google Cloud project selected:

1. **Enable YouTube API:** create/select a project and enable **YouTube Data API v3**.
2. **Consent & test users:** configure the consent screen’s app name and support email. Select **External → Testing** and add your Google email as a **Test user**. If the console asks for scopes, add `https://www.googleapis.com/auth/youtube.readonly` under Data Access.
3. **Desktop client:** create an **OAuth client ID** of type **Desktop app**, then download its JSON file.
4. Back in Chat Stream, click **Import Google OAuth JSON** and select that file. Leave it outside the repository; you do not need to paste secrets into this conversation.
5. Leave Livestream URL empty and click **Connect YouTube**. Sign in in your browser, choose the YouTube channel that owns your broadcast, and approve read-only YouTube access. Then return to the app.
6. If you are already live, the app finds your broadcast. Otherwise it waits and checks every 60 seconds. If discovery misses the stream, paste its direct livestream URL and click Connect again.

Already have the Desktop OAuth JSON and API enabled? Start at step 4. Web application and service-account credentials are different and will be rejected.

## 3. Verify together

- Start your stream normally with FFmpeg. Keep the app’s Connections window open to watch both statuses.
- From each platform’s own website, send one recognizable test message. Chat Stream is read-only, so it cannot send these for you.
- Confirm the overlay shows both platform labels, usernames, and messages in timestamp order.
- Try opacity, text size, and always-on-top. Enable click-through and use **⌘⇧X**, or the menu bar **Turn click-through OFF**, to regain mouse control.
- Hide the overlay and restore it from the menu bar. Your chat connections stay alive.

## After the first setup

Use `npm start`, or open the packaged **Chat Stream.app**. Saved authorized accounts reconnect automatically. For a new YouTube stream with a different URL, clear the old URL for automatic discovery or paste the new one and click Connect. Google Testing tokens may require authorization again after seven days.

If authorization fails, copy the visible status text, not any token or secret. Common fixes:

| Status/problem                       | Fix                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Twitch setup rejected                | Confirm the developer app is **Public** and its Client ID was saved.          |
| Google access blocked for a test app | Add the signing-in Google account under **Test users** in the same project.   |
| Wrong JSON type                      | Download a **Desktop app** OAuth client JSON.                                 |
| YouTube permission/API error         | Enable YouTube Data API v3 and approve the read-only permission.              |
| No active YouTube broadcast          | Start the broadcast or paste a direct video URL; ensure live chat is enabled. |
| Authorization expired/revoked        | **Forget account**, then **Connect** and approve again.                       |
| YouTube ended/disabled               | Enable chat on the next broadcast and reconnect.                              |

The account sign-in and consent steps must be completed by you in the provider’s browser pages. Once both accounts are authorized, finish with a test message from each platform's website and confirm both appear in the overlay.
