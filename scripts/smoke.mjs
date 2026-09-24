import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const data = await mkdtemp(join(tmpdir(), "chat-stream-smoke-"));
await writeFile(
  join(data, "settings.json"),
  JSON.stringify({ settings: { clickThrough: true, soundEnabled: false } }),
);
const packaged = process.env.CHAT_STREAM_SMOKE_PACKAGED === "1";
const app = await electron.launch({
  ...(packaged
    ? {
        executablePath: join(
          process.cwd(),
          "release",
          process.arch === "arm64" ? "mac-arm64" : "mac",
          "Chat Stream.app/Contents/MacOS/Chat Stream",
        ),
      }
    : {}),
  args: [...(packaged ? [] : ["."]), "--smoke-test", "--demo"],
  env: { ...process.env, CHAT_STREAM_TEST_DATA: data },
});
const results = [];
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator(".message[data-platform=twitch]").first().waitFor();
  await page.locator(".message[data-platform=youtube]").first().waitFor();
  assert.equal(await page.locator("#mode-label").textContent(), "DEMO MODE");
  assert.equal(
    (await page.evaluate(() => window.chatStream.state())).settings
      .clickThrough,
    false,
  );
  results.push(
    "Native Electron app launched on " +
      process.platform +
      "; Twitch and YouTube demo messages displayed.",
  );
  assert.equal(
    await app.evaluate(({ globalShortcut }) =>
      globalShortcut.isRegistered("CommandOrControl+Shift+X"),
    ),
    true,
  );
  const security = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const p = w.webContents.getLastWebPreferences();
    return {
      isolated: p.contextIsolation,
      sandbox: p.sandbox,
      node: p.nodeIntegration,
      resizable: w.isResizable(),
      top: w.isAlwaysOnTop(),
    };
  });
  assert.deepEqual(security, {
    isolated: true,
    sandbox: true,
    node: false,
    resizable: true,
    top: true,
  });
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  results.push(
    "Renderer sandbox/context isolation enabled; Node unavailable; window resizable.",
  );
  await page.locator("#opacity").fill("70");
  await page.locator("#opacity").dispatchEvent("input");
  await page.waitForFunction(
    () => document.querySelector("#opacity-value").textContent === "70%",
  );
  assert(
    Math.abs(
      (await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getOpacity(),
      )) - 0.7,
    ) < 0.02,
  );
  await page.locator("#font").fill("22");
  await page.locator("#font").dispatchEvent("input");
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".message p")).fontSize ===
      "22px",
  );
  await page.locator("#pin").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#pin").getAttribute("aria-pressed") === "false",
  );
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isAlwaysOnTop(),
    ),
    false,
  );
  results.push(
    "Opacity, font size, and always-on-top controls changed native/rendered state.",
  );
  const windowBounds = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setBounds({ x: 100, y: 100, width: 440, height: 720 });
    return w.getBounds();
  });
  assert.equal(windowBounds.width, 440);
  assert.equal(windowBounds.height, 720);
  results.push("Native overlay moved and resized to 440 × 720.");
  // Intercept only to observe that the real native mouse-ignore method is invoked.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const original = w.setIgnoreMouseEvents.bind(w);
    w.setIgnoreMouseEvents = (ignore, options) => {
      globalThis.__smokeIgnored = ignore;
      return original(ignore, options);
    };
  });
  await page.locator("#click-through").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#click-through").getAttribute("aria-pressed") ===
      "true",
  );
  assert.equal(await app.evaluate(() => globalThis.__smokeIgnored), true);
  await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const item = menu.items[0].submenu.items.find(
      (i) => i.label === "Turn click-through OFF",
    );
    item.click();
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#click-through").getAttribute("aria-pressed") ===
      "false",
  );
  assert.equal(await app.evaluate(() => globalThis.__smokeIgnored), false);
  results.push(
    "Native click-through enabled, then disabled using the menu recovery command.",
  );
  assert.equal(await page.locator("#sound").textContent(), "Sound: OFF");
  await app.evaluate(({ shell }) => {
    const beep = shell.beep.bind(shell);
    globalThis.__smokeSoundCalls = 0;
    shell.beep = () => {
      globalThis.__smokeSoundCalls++;
      // Exercise the real native sound once, then count subsequent alerts quietly.
      if (globalThis.__smokeSoundCalls === 1) beep();
    };
  });
  await page.locator("#test-sound").click();
  assert.equal(await app.evaluate(() => globalThis.__smokeSoundCalls), 1);
  await page.locator("#sound").click();
  await page.waitForFunction(
    () => document.querySelector("#sound").textContent === "Sound: ON",
  );
  const soundCalls = await app.evaluate(() => globalThis.__smokeSoundCalls);
  await page.locator("#hide").click();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    false,
  );
  const deadline = Date.now() + 10000;
  while (
    (await app.evaluate(() => globalThis.__smokeSoundCalls)) <= soundCalls
  ) {
    assert(
      Date.now() < deadline,
      "A new demo message should alert while hidden",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().items[0].submenu.items.find(
      (i) => i.label === "Message sounds",
    );
    item.click();
  });
  const mutedCalls = await app.evaluate(() => globalThis.__smokeSoundCalls);
  const mutedCount = (await page.evaluate(() => window.chatStream.state()))
    .messages.length;
  await page.waitForFunction(
    async (count) => (await window.chatStream.state()).messages.length > count,
    mutedCount,
    { polling: 100 },
  );
  assert.equal(
    await app.evaluate(() => globalThis.__smokeSoundCalls),
    mutedCalls,
  );
  assert.equal(
    JSON.parse(await readFile(join(data, "settings.json"), "utf8")).settings
      .soundEnabled,
    false,
  );
  assert.equal(
    (await page.evaluate(() => window.chatStream.state())).settings
      .soundEnabled,
    false,
  );
  results.push(
    "Native sound preview, overlay/menu toggles, saved mute, and alerts while hidden verified.",
  );
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items[0].submenu.items.find((i) => i.label === "Show overlay")
      .click(),
  );
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    true,
  );
  results.push("Hide kept app alive; menu restored overlay.");
  await page.waitForFunction(
    () => document.querySelector("#sound").textContent === "Sound: OFF",
  );
  await page.locator("#sound").click();
  const newWindow = app.waitForEvent("window");
  await page.locator("#connections").click();
  const connection = await newWindow;
  await connection.waitForLoadState();
  await connection.locator("#connect-twitch").waitFor();
  assert.equal(await connection.locator("#connect-twitch").isDisabled(), true);
  assert.equal(await connection.locator("#connect-youtube").isDisabled(), true);
  await connection
    .locator("#youtube-url")
    .fill("https://example.com/not-youtube");
  const invalid = await connection.evaluate(() =>
    window.chatStream.action({
      type: "connect",
      platform: "youtube",
      youtubeUrl: "https://example.com/not-youtube",
    }),
  );
  assert.equal(invalid.ok, false);
  results.push(
    "Connection screen opens; missing credentials and invalid video URLs handled.",
  );
  await mkdir(".context", { recursive: true });
  await page.screenshot({ path: ".context/overlay-demo.png" });
  await connection.locator("#youtube-url").fill("");
  await connection.screenshot({ path: ".context/connections.png" });
  assert.deepEqual(errors, []);
  results.push("No renderer errors. Screenshots saved in .context/.");
  const persisted = await page.evaluate(() => window.chatStream.state());
  assert.equal(persisted.settings.clickThrough, false);
  await writeFile(
    ".context/smoke-results.json",
    JSON.stringify(
      {
        time: new Date().toISOString(),
        platform: process.platform,
        electron: await app.evaluate(() => process.versions.electron),
        results,
      },
      null,
      2,
    ),
  );
  for (const result of results) console.log("PASS", result);
} finally {
  await app.close();
}
