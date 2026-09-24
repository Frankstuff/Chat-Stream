import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  globalShortcut,
  ipcMain,
  dialog,
  powerMonitor,
  screen,
  shell,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { Store } from "./store";
import { Auth } from "./auth";
import { Twitch } from "./twitch";
import { YouTube } from "./youtube";
import { MessageSounds } from "./sounds";
import { Feed, settingsPatch, videoId } from "./core";
import type { Action, Platform, PublicState, Connection } from "../shared";
app.setName("Chat Stream");
if (process.argv.includes("--smoke-test") && process.env.CHAT_STREAM_TEST_DATA)
  app.setPath("userData", process.env.CHAT_STREAM_TEST_DATA);
let overlay: BrowserWindow,
  connections: BrowserWindow | undefined,
  tray: Tray,
  store: Store,
  auth: Auth;
let quitting = false,
  demo = false,
  shortcutAvailable = false,
  toggleShortcutAvailable = false,
  demoTimer: NodeJS.Timeout | undefined,
  emitTimer: NodeJS.Timeout | undefined,
  boundsTimer: NodeJS.Timeout | undefined;
const feed = new Feed();
const sounds = new MessageSounds(() => shell.beep());
const states: Record<Platform, Connection> = {
  twitch: { state: "disconnected", detail: "Connect your Twitch account" },
  youtube: { state: "disconnected", detail: "Connect your YouTube account" },
};
const running: Partial<Record<Platform, AbortController>> = {};
const ui = join(__dirname, "../renderer/index.html");
const uiUrl = pathToFileURL(ui).href;
function state(): PublicState {
  return {
    settings: store.prefs.settings,
    demo,
    messages: feed.messages,
    connections: states,
    configured: {
      twitch: !!store.secrets.twitchClientId,
      youtube: !!store.secrets.googleClientId,
    },
    authorized: {
      twitch: !!store.secrets.twitch,
      youtube: !!store.secrets.youtube,
    },
    twitchChannel: store.prefs.twitchChannel,
    youtubeUrl: store.prefs.youtubeUrl,
    shortcutAvailable,
    toggleShortcutAvailable,
  };
}
function emit() {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = undefined;
    for (const win of BrowserWindow.getAllWindows())
      if (!win.isDestroyed()) win.webContents.send("chat:state", state());
  }, 60);
}
function status(platform: Platform, value: Connection) {
  states[platform] = value;
  emit();
}
function receiveMessage(message: Parameters<Feed["add"]>[0], connectedAt = 0) {
  if (!feed.add(message)) return;
  sounds.notify(message, store.prefs.settings.soundEnabled, connectedAt);
  emit();
}
function disconnect(platform: Platform) {
  running[platform]?.abort();
  delete running[platform];
  status(platform, {
    state: "disconnected",
    detail: store.secrets[platform]
      ? "Disconnected · credentials kept on this Mac"
      : "Connect your " +
        (platform === "twitch" ? "Twitch" : "YouTube") +
        " account",
  });
}
function setDemo(enabled: boolean) {
  clearInterval(demoTimer);
  demo = enabled;
  feed.clear();
  if (enabled) {
    disconnect("twitch");
    disconnect("youtube");
    let n = 0;
    const samples = [
      ["twitch", "pixelpilot", "Hey chat! Good to be here 👋"],
      ["youtube", "Maya Chen", "Audio sounds great from YouTube!"],
      ["twitch", "nightowl", "Two chats, one cozy little window."],
      ["youtube", "Alex", "Ready when you are ✨"],
      ["twitch", "coffeecode", "That was such a good explanation."],
      ["youtube", "Sam", "Watching from the other side of the world 🌎"],
    ];
    const add = () => {
      const [platform, username, text] = samples[n % samples.length];
      receiveMessage({
        id: `demo-${n++}`,
        platform: platform as Platform,
        username,
        text,
        timestamp: Date.now(),
        demo: true,
      });
    };
    add();
    add();
    demoTimer = setInterval(add, 2600);
  }
  updateMenu();
  emit();
}
async function connect(platform: Platform) {
  if (demo) setDemo(false);
  disconnect(platform);
  const controller = new AbortController();
  running[platform] = controller;
  status(platform, { state: "connecting", detail: "Connecting…" });
  try {
    if (!store.secrets[platform]) {
      if (platform === "twitch")
        await auth.twitch(controller.signal, (text) =>
          status(platform, { state: "connecting", detail: text }),
        );
      else {
        status(platform, {
          state: "connecting",
          detail: "Authorize read-only YouTube access in your browser…",
        });
        await auth.youtube(controller.signal);
      }
    }
    controller.signal.throwIfAborted();
    emit();
    const connectedAt = Date.now();
    const message = (m: Parameters<Feed["add"]>[0]) => {
      if (!controller.signal.aborted) receiveMessage(m, connectedAt);
    };
    const change = (s: Connection) => {
      if (!controller.signal.aborted) status(platform, s);
    };
    if (platform === "twitch")
      await new Twitch(auth, store, message, change).run(controller.signal);
    else
      await new YouTube(
        auth,
        message,
        change,
        join(app.getAppPath(), "assets/stream_list.proto"),
      ).run(controller.signal, store.prefs.youtubeUrl);
  } catch (error) {
    if (!controller.signal.aborted)
      status(platform, {
        state: "error",
        detail:
          error instanceof Error
            ? error.message
            : "Connection failed. Try again.",
      });
  } finally {
    if (running[platform] === controller) delete running[platform];
  }
}
function secure(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
}
function applySettings() {
  const s = store.prefs.settings;
  overlay.setOpacity(s.opacity);
  overlay.setAlwaysOnTop(s.alwaysOnTop, "floating");
  overlay.setIgnoreMouseEvents(s.clickThrough, { forward: true });
  store.savePrefs();
  updateMenu();
  emit();
}
function showOverlay() {
  overlay.show();
  updateMenu();
}
function toggleClickThrough() {
  store.prefs.settings.clickThrough = !store.prefs.settings.clickThrough;
  applySettings();
}
function unlock() {
  store.prefs.settings.clickThrough = false;
  applySettings();
  showOverlay();
}
function showConnections() {
  if (connections && !connections.isDestroyed()) {
    connections.show();
    connections.focus();
    return;
  }
  connections = new BrowserWindow({
    title: "Chat Stream · Connections",
    width: 640,
    height: 810,
    minWidth: 560,
    minHeight: 620,
    backgroundColor: "#11151b",
    webPreferences: {
      preload: join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  secure(connections);
  void connections.loadFile(ui, { query: { view: "connections" } });
  connections.on("closed", () => {
    connections = undefined;
  });
}
function updateMenu() {
  if (!tray || !store) return;
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: "Chat Stream", enabled: false },
    { type: "separator" },
    { label: "Show overlay", click: showOverlay },
    {
      label: "Hide overlay",
      click: () => {
        overlay.hide();
        updateMenu();
      },
    },
    {
      label: "Turn click-through OFF",
      accelerator: "CommandOrControl+Shift+X",
      click: unlock,
    },
    {
      label: "Click-through (pass clicks to apps below)",
      accelerator: "CommandOrControl+Shift+C",
      type: "checkbox",
      checked: store.prefs.settings.clickThrough,
      click: (item) => {
        store.prefs.settings.clickThrough = item.checked;
        applySettings();
      },
    },
    {
      label: "Always on top",
      type: "checkbox",
      checked: store.prefs.settings.alwaysOnTop,
      click: (item) => {
        store.prefs.settings.alwaysOnTop = item.checked;
        applySettings();
      },
    },
    { type: "separator" },
    {
      label: "Message sounds",
      type: "checkbox",
      checked: store.prefs.settings.soundEnabled,
      click: (item) => {
        store.prefs.settings.soundEnabled = item.checked;
        applySettings();
      },
    },
    { label: "Test sound", click: () => sounds.preview() },
    { type: "separator" },
    { label: "Connections…", click: showConnections },
    {
      label: "Demo mode",
      type: "checkbox",
      checked: demo,
      click: (item) => setDemo(item.checked),
    },
    { type: "separator" },
    {
      label: "Quit Chat Stream",
      accelerator: "CommandOrControl+Q",
      click: () => app.quit(),
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "Chat Stream", submenu: items },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { label: "Connections…", click: showConnections },
          { label: "Show overlay", click: showOverlay },
        ],
      },
    ]),
  );
}
function checkSender(event: Electron.IpcMainInvokeEvent) {
  const frame = event.senderFrame;
  if (
    !frame ||
    frame !== event.sender.mainFrame ||
    frame.url.split("?")[0] !== uiUrl ||
    !BrowserWindow.fromWebContents(event.sender)
  )
    throw new Error("Untrusted request.");
}
function platformValue(value: unknown): Platform {
  if (value !== "twitch" && value !== "youtube")
    throw new Error("Invalid platform.");
  return value;
}
async function action(value: Action) {
  if (!value || typeof value !== "object") throw new Error("Invalid action.");
  switch (value.type) {
    case "setup": {
      const pages = {
        twitch: "https://dev.twitch.tv/console/apps",
        googleApi:
          "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
        googleConsent: "https://console.cloud.google.com/auth/audience",
        googleClient: "https://console.cloud.google.com/auth/clients",
      };
      if (!Object.hasOwn(pages, value.page))
        throw new Error("Unknown setup page.");
      await shell.openExternal(pages[value.page]);
      break;
    }
    case "settings":
      Object.assign(store.prefs.settings, settingsPatch(value.patch));
      applySettings();
      break;
    case "testSound":
      sounds.preview();
      break;
    case "demo":
      if (typeof value.enabled !== "boolean")
        throw new Error("Invalid demo setting.");
      setDemo(value.enabled);
      break;
    case "hide":
      overlay.hide();
      updateMenu();
      break;
    case "show":
      showOverlay();
      break;
    case "connections":
      showConnections();
      break;
    case "clear":
      feed.clear();
      emit();
      break;
    case "configureTwitch": {
      if (typeof value.clientId !== "string")
        throw new Error("Invalid Client ID.");
      const clientId =
        value.clientId.trim() || store.secrets.twitchClientId || "";
      if (!/^[a-zA-Z0-9]{10,100}$/.test(clientId))
        throw new Error(
          "Enter the Client ID from your Twitch public application.",
        );
      if (
        typeof value.channel !== "string" ||
        !/^\w{0,25}$/.test(value.channel.trim())
      )
        throw new Error("Use a Twitch channel login, not a URL.");
      disconnect("twitch");
      if (store.secrets.twitchClientId !== clientId)
        delete store.secrets.twitch;
      store.secrets.twitchClientId = clientId;
      store.prefs.twitchChannel = value.channel.trim().toLowerCase();
      store.saveSecrets();
      store.savePrefs();
      emit();
      break;
    }
    case "importGoogle": {
      const result = await dialog.showOpenDialog({
        title: "Import Google Desktop OAuth client JSON",
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled) return;
      let installed: any;
      try {
        installed = JSON.parse(
          readFileSync(result.filePaths[0], "utf8"),
        ).installed;
      } catch {
        throw new Error("Could not read OAuth client JSON.");
      }
      if (
        typeof installed?.client_id !== "string" ||
        !installed.client_id.endsWith(".apps.googleusercontent.com") ||
        typeof installed.client_secret !== "string"
      )
        throw new Error(
          "Choose a Google OAuth client JSON of type Desktop app.",
        );
      disconnect("youtube");
      delete store.secrets.youtube;
      store.secrets.googleClientId = installed.client_id;
      store.secrets.googleClientSecret = installed.client_secret;
      store.saveSecrets();
      emit();
      break;
    }
    case "connect": {
      const p = platformValue(value.platform);
      if (p === "youtube") {
        if (
          value.youtubeUrl !== undefined &&
          (typeof value.youtubeUrl !== "string" ||
            value.youtubeUrl.length > 2048)
        )
          throw new Error("Invalid YouTube URL.");
        const url = value.youtubeUrl?.trim() || "";
        if (url) videoId(url);
        store.prefs.youtubeUrl = url;
        store.savePrefs();
      }
      void connect(p);
      break;
    }
    case "disconnect":
      disconnect(platformValue(value.platform));
      break;
    case "forget": {
      const p = platformValue(value.platform);
      disconnect(p);
      delete store.secrets[p];
      store.saveSecrets();
      status(p, {
        state: "disconnected",
        detail: "Account forgotten on this Mac",
      });
      break;
    }
    default:
      throw new Error("Unknown action.");
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (overlay) unlock();
  });
  void app
    .whenReady()
    .then(() => {
      store = new Store();
      auth = new Auth(store, (url) => shell.openExternal(url));
      const saved = store.prefs.bounds,
        display = screen.getPrimaryDisplay().workArea;
      const bounds =
        saved &&
        screen
          .getAllDisplays()
          .some(
            (d) =>
              saved.x < d.workArea.x + d.workArea.width &&
              saved.x + saved.width > d.workArea.x &&
              saved.y < d.workArea.y + d.workArea.height &&
              saved.y + saved.height > d.workArea.y,
          )
          ? saved
          : {
              x: display.x + display.width - 440,
              y: display.y + 60,
              width: 400,
              height: 660,
            };
      overlay = new BrowserWindow({
        ...bounds,
        minWidth: 320,
        minHeight: 360,
        title: "Chat Stream",
        frame: false,
        transparent: true,
        hasShadow: true,
        resizable: true,
        webPreferences: {
          preload: join(__dirname, "../preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      secure(overlay);
      overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      void overlay.loadFile(ui);
      overlay.on("close", (e) => {
        if (!quitting) {
          e.preventDefault();
          overlay.hide();
          updateMenu();
        }
      });
      const saveBounds = () => {
        clearTimeout(boundsTimer);
        boundsTimer = setTimeout(() => {
          if (!overlay.isDestroyed()) {
            store.prefs.bounds = overlay.getBounds();
            store.savePrefs();
          }
        }, 150);
      };
      overlay.on("move", saveBounds);
      overlay.on("resize", saveBounds);
      const icon = nativeImage
        .createFromPath(join(app.getAppPath(), "assets/trayTemplate.png"))
        .resize({ width: 18, height: 18 });
      icon.setTemplateImage(true);
      tray = new Tray(icon);
      tray.setToolTip("Chat Stream — Twitch + YouTube");
      shortcutAvailable = globalShortcut.register(
        "CommandOrControl+Shift+X",
        unlock,
      );
      toggleShortcutAvailable = globalShortcut.register(
        "CommandOrControl+Shift+C",
        toggleClickThrough,
      );
      globalShortcut.register("CommandOrControl+Shift+O", () =>
        overlay.isVisible() ? overlay.hide() : showOverlay(),
      );
      applySettings();
      ipcMain.handle("chat:state", (event) => {
        checkSender(event);
        return state();
      });
      ipcMain.handle("chat:action", async (event, value) => {
        checkSender(event);
        try {
          await action(value);
          return { ok: true };
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : "Action failed.",
          };
        }
      });
      powerMonitor.on("resume", () => {
        for (const p of ["twitch", "youtube"] as const)
          if (running[p]) void connect(p);
      });
      if (process.argv.includes("--demo")) setDemo(true);
      else if (!store.secrets.twitch && !store.secrets.youtube)
        showConnections();
      else
        for (const p of ["twitch", "youtube"] as const)
          if (store.secrets[p]) void connect(p);
      app.on("activate", showOverlay);
    })
    .catch((error) => {
      dialog.showErrorBox(
        "Chat Stream could not start",
        error instanceof Error ? error.message : "Startup failed.",
      );
      app.quit();
    });
}
app.on("window-all-closed", () => {
  /* The menu bar keeps the app running. */
});
app.on("before-quit", () => {
  quitting = true;
  clearTimeout(boundsTimer);
  if (store && overlay && !overlay.isDestroyed()) {
    store.prefs.bounds = overlay.getBounds();
    store.savePrefs();
  }
  clearInterval(demoTimer);
  for (const p of ["twitch", "youtube"] as const) running[p]?.abort();
  globalShortcut.unregisterAll();
});
