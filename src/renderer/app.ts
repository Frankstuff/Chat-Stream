import type { Action, PublicState, Platform, SetupPage } from "../shared";
const root = document.querySelector<HTMLElement>("#app")!;
const connectionView =
  new URLSearchParams(location.search).get("view") === "connections";
let current: PublicState | undefined,
  lastMessageKey = "",
  initialized = false;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const escapeText = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
async function send(action: Action) {
  try {
    const result = await window.chatStream.action(action);
    $("error").textContent = result.error || "";
    return result.ok;
  } catch {
    $("error").textContent = "Could not reach the app. Restart Chat Stream.";
    return false;
  }
}
if (connectionView) {
  root.innerHTML = `<div class="connection-page"><header class="connection-header"><div class="brand-icon">···</div><div><p class="eyebrow">YOUR CHAT, TOGETHER</p><h1>Chat Stream</h1><p>A little window for your whole community.</p></div></header><div id="error" class="error-banner" role="alert"></div>
  <p class="setup-intro">Connect once, then open and go. Set up each developer app below, authorize in your browser, and your chats will appear automatically.</p><section class="card"><div class="card-head"><span class="platform twitch">Twitch</span><h2>Twitch chat</h2><span class="status-label" id="twitch-state"></span></div><p class="status-detail" id="twitch-detail" role="status"></p><div class="setup-steps" id="twitch-steps"></div><label class="field" for="twitch-client">Application Client ID</label><input type="text" id="twitch-client" autocomplete="off" placeholder="Client ID from your Twitch public app"><label class="field" for="twitch-channel">Channel login <span class="subtitle">· optional</span></label><input type="text" id="twitch-channel" autocomplete="off" placeholder="Leave empty to read your own channel"><div class="row"><button id="save-twitch">Save configuration</button><button class="primary" id="connect-twitch">Connect Twitch</button><button class="subtle" id="disconnect-twitch">Disconnect</button><button class="subtle" id="forget-twitch">Forget account</button></div><details class="details"><summary>Start here: create your Twitch app</summary><div class="row"><button data-setup="twitch">Open Twitch developer console ↗</button></div><p>Register an app at dev.twitch.tv/console/apps. Choose <b>Public</b> client type and use https://localhost as the required redirect URL (device login does not use it). Paste the Client ID above and save. Connect opens Twitch in your browser; approve <b>user:read:chat</b>. No client secret or stream key needed.</p></details></section>
  <section class="card"><div class="card-head"><span class="platform youtube">YouTube</span><h2>YouTube live chat</h2><span class="status-label" id="youtube-state"></span></div><p class="status-detail" id="youtube-detail" role="status"></p><div class="setup-steps" id="youtube-steps"></div><div class="row"><button id="import-google">Import Google OAuth JSON</button><span class="help" id="google-config"></span></div><label class="field" for="youtube-url">Livestream URL <span class="subtitle">· optional</span></label><input type="text" id="youtube-url" autocomplete="off" placeholder="Leave empty to find your active broadcast"><div class="row"><button class="primary" id="connect-youtube">Connect YouTube</button><button class="subtle" id="disconnect-youtube">Disconnect</button><button class="subtle" id="forget-youtube">Forget account</button></div><details class="details"><summary>Start here: create your Google desktop client</summary><div class="row"><button data-setup="googleApi">1 · Enable YouTube API ↗</button><button data-setup="googleConsent">2 · Consent &amp; test users ↗</button><button data-setup="googleClient">3 · Desktop client ↗</button></div><p>In Google Cloud, enable <b>YouTube Data API v3</b>, configure the OAuth consent screen, and add your Google account as a test user. Create an OAuth client of type <b>Desktop app</b>, download its JSON, and import it here. Connect opens Google in your browser to request <b>youtube.readonly</b>. Select the account/channel that owns your broadcast.</p></details></section>
  <section class="card demo-card"><div><h2>A quick soundcheck. For your eyes.</h2><p>Try simulated Twitch and YouTube messages.</p></div><button id="demo" class="primary">Try demo</button></section>
  <footer class="connection-bottom"><p>Read-only. Local to your Mac.<br>Credentials encrypted with macOS Keychain protection.</p><button id="show">Show overlay ↗</button></footer></div>`;
  document
    .querySelectorAll<HTMLButtonElement>("[data-setup]")
    .forEach((button) => {
      button.onclick = () =>
        void send({ type: "setup", page: button.dataset.setup as SetupPage });
    });
  $("save-twitch").onclick = async () => {
    const ok = await send({
      type: "configureTwitch",
      clientId: $<HTMLInputElement>("twitch-client").value,
      channel: $<HTMLInputElement>("twitch-channel").value,
    });
    if (ok) {
      $<HTMLInputElement>("twitch-client").value = "";
      $("twitch-client").setAttribute(
        "placeholder",
        "Saved on this Mac · enter a new ID to replace",
      );
    }
  };
  $("import-google").onclick = () => void send({ type: "importGoogle" });
  for (const platform of ["twitch", "youtube"] as const) {
    $(`connect-${platform}`).onclick = () =>
      void send({
        type: "connect",
        platform,
        ...(platform === "youtube"
          ? { youtubeUrl: $<HTMLInputElement>("youtube-url").value }
          : {}),
      });
    $(`disconnect-${platform}`).onclick = () =>
      void send({ type: "disconnect", platform });
    $(`forget-${platform}`).onclick = () =>
      void send({ type: "forget", platform });
  }
  $("demo").onclick = async () => {
    await send({ type: "demo", enabled: !current?.demo });
    await send({ type: "show" });
  };
  $("show").onclick = () => void send({ type: "show" });
} else {
  root.innerHTML = `<section class="overlay"><header class="topbar" title="Drag to move the overlay"><div class="brand-icon">···</div><span class="brand">Chat Stream</span><button class="subtle" id="connections" aria-label="Open connections" title="Connections">⚙</button><button class="subtle" id="hide" aria-label="Hide overlay" title="Hide to menu bar">−</button></header><div class="feed-info"><span class="pill" id="twitch-pill"><i class="dot" id="twitch-dot"></i>Twitch</span><span class="pill" id="youtube-pill"><i class="dot" id="youtube-dot"></i>YouTube</span><span class="demo-tag" id="mode-label">READ ONLY</span></div><div id="error" class="error-banner" role="alert"></div><div class="messages" id="messages" role="log" aria-label="Combined livestream chat" aria-live="polite"><div class="empty"><span class="empty-icon">◌</span><strong>One window. Everyone here.</strong><p>Connect your channels to bring both conversations together.</p><button id="empty-connect">Connect accounts</button><button class="subtle" id="empty-demo">Or try a demo →</button></div></div><button class="jump" id="jump" hidden>Jump to latest ↓</button><section class="controls" aria-label="Overlay controls"><div class="sliders"><label><span class="range-label">Opacity <output id="opacity-value">94%</output></span><input id="opacity" aria-label="Overlay opacity" type="range" min="20" max="100" value="94"></label><label><span class="range-label">Text size <output id="font-value">16 px</output></span><input id="font" aria-label="Font size" type="range" min="12" max="32" value="16"></label></div><div class="toggles"><button id="pin" aria-pressed="true">Always on top</button><button id="click-through" aria-pressed="false" title="Pass all mouse clicks to the app below. Use ⌘⇧X or the menu bar to edit again.">Click-through: OFF</button><button class="subtle clear" id="clear">Clear</button></div><div class="toggles sound-controls"><button id="sound" aria-pressed="true" title="Play an alert for new chat messages, even when the overlay is hidden.">Sound: ON</button><button id="test-sound" class="subtle" title="Preview your Mac’s alert sound.">Test sound</button></div><p class="shortcut" id="shortcut">Mouse locked? <strong>⌘ ⇧ X</strong> unlocks · or use the menu bar.</p></section><footer class="footer"><span class="dot connected"></span><span>LOCAL · READ ONLY</span><span id="count">0 messages</span></footer></section>`;
  $("connections").onclick = () => void send({ type: "connections" });
  $("hide").onclick = () => void send({ type: "hide" });
  $("empty-connect").onclick = () => void send({ type: "connections" });
  $("empty-demo").onclick = () => void send({ type: "demo", enabled: true });
  $("pin").onclick = () =>
    void send({
      type: "settings",
      patch: { alwaysOnTop: !current?.settings.alwaysOnTop },
    });
  $("click-through").onclick = () =>
    void send({
      type: "settings",
      patch: { clickThrough: !current?.settings.clickThrough },
    });
  $("clear").onclick = () => void send({ type: "clear" });
  $("sound").onclick = () =>
    void send({
      type: "settings",
      patch: { soundEnabled: !current?.settings.soundEnabled },
    });
  $("test-sound").onclick = () => void send({ type: "testSound" });
  $<HTMLInputElement>("opacity").oninput = (event) =>
    void send({
      type: "settings",
      patch: {
        opacity: Number((event.target as HTMLInputElement).value) / 100,
      },
    });
  $<HTMLInputElement>("font").oninput = (event) =>
    void send({
      type: "settings",
      patch: { fontSize: Number((event.target as HTMLInputElement).value) },
    });
  $("jump").onclick = () => {
    $("messages").scrollTop = $("messages").scrollHeight;
    $("jump").hidden = true;
  };
  $("messages").onscroll = () => {
    const el = $("messages");
    $("jump").hidden = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
  };
}
function render(state: PublicState) {
  current = state;
  if (connectionView) {
    for (const platform of ["twitch", "youtube"] as Platform[]) {
      const steps = [
        state.configured[platform],
        state.authorized[platform],
        state.connections[platform].state === "connected",
      ];
      $(`${platform}-steps`).replaceChildren(
        ...["Developer app", "Authorize account", "Read live chat"].map(
          (label, index) => {
            const step = document.createElement("span");
            step.className = steps[index] ? "done" : "";
            step.textContent = `${steps[index] ? "✓" : index + 1} ${label}`;
            return step;
          },
        ),
      );
      $(`${platform}-state`).textContent = state.connections[platform].state;
      $(`${platform}-detail`).textContent = state.connections[platform].detail;
      $<HTMLButtonElement>(`connect-${platform}`).disabled =
        !state.configured[platform] ||
        state.connections[platform].state === "connecting";
      $<HTMLButtonElement>(`forget-${platform}`).disabled =
        !state.authorized[platform];
    }
    $("google-config").textContent = state.configured.youtube
      ? "Desktop client saved"
      : "Not configured";
    $("demo").textContent = state.demo ? "Stop demo" : "Try demo";
    if (!initialized) {
      $<HTMLInputElement>("twitch-channel").value = state.twitchChannel;
      $<HTMLInputElement>("youtube-url").value = state.youtubeUrl;
      if (state.configured.twitch)
        $("twitch-client").setAttribute(
          "placeholder",
          "Saved on this Mac · enter a new ID to replace",
        );
    }
  } else {
    document.documentElement.style.setProperty(
      "--font-size",
      `${state.settings.fontSize}px`,
    );
    $<HTMLInputElement>("opacity").value = String(
      Math.round(state.settings.opacity * 100),
    );
    $("opacity-value").textContent =
      `${Math.round(state.settings.opacity * 100)}%`;
    $<HTMLInputElement>("font").value = String(state.settings.fontSize);
    $("font-value").textContent = `${state.settings.fontSize} px`;
    $("pin").setAttribute("aria-pressed", String(state.settings.alwaysOnTop));
    $("click-through").setAttribute(
      "aria-pressed",
      String(state.settings.clickThrough),
    );
    $("click-through").textContent =
      `Click-through: ${state.settings.clickThrough ? "ON" : "OFF"}`;
    $("sound").setAttribute(
      "aria-pressed",
      String(state.settings.soundEnabled),
    );
    $("sound").textContent =
      `Sound: ${state.settings.soundEnabled ? "ON" : "OFF"}`;
    $("mode-label").textContent = state.demo ? "DEMO MODE" : "READ ONLY";
    $("count").textContent = `${state.messages.length} messages`;
    $("shortcut").textContent = state.shortcutAvailable
      ? state.settings.clickThrough
        ? "Click-through ON · ⌘ ⇧ X or menu bar to unlock."
        : state.toggleShortcutAvailable
          ? "⌘ ⇧ C toggles click-through · ⌘ ⇧ X unlocks."
          : "Use the menu bar to toggle click-through · ⌘ ⇧ X unlocks."
      : "Use the Chat Stream menu bar icon to turn click-through OFF (shortcut unavailable).";
    for (const platform of ["twitch", "youtube"] as Platform[]) {
      $(`${platform}-dot`).className =
        "dot " + (state.demo ? "connected" : state.connections[platform].state);
      $(`${platform}-pill`).title = state.demo
        ? "Simulated messages"
        : state.connections[platform].detail;
    }
    const key = state.messages.map((m) => m.platform + m.id).join("|");
    if (key !== lastMessageKey) {
      const el = $("messages"),
        atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
      if (!state.messages.length) {
        el.innerHTML =
          '<div class="empty"><span class="empty-icon">◌</span><strong>All caught up.</strong><p>New chat messages will appear here.<br>Use ⚙ to connect accounts or start a demo.</p></div>';
      } else
        el.innerHTML = state.messages
          .map(
            (m) =>
              `<article class="message" data-platform="${m.platform}"><div class="message-meta"><span class="platform ${m.platform}">${m.platform === "twitch" ? "Twitch" : "YouTube"}</span><span class="username">${escapeText(m.username)}</span><time datetime="${new Date(m.timestamp).toISOString()}">${new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div><p>${escapeText(m.text)}</p></article>`,
          )
          .join("");
      if (atBottom) el.scrollTop = el.scrollHeight;
      else $("jump").hidden = false;
      lastMessageKey = key;
    }
  }
  initialized = true;
}
window.chatStream.subscribe(render);
void window.chatStream
  .state()
  .then(render)
  .catch(() => {
    $("error").textContent = "Could not load app state. Restart Chat Stream.";
  });
