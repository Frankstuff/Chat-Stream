import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), "chat-stream-native-"));
const clickBinary = join(dir, "click");
await exec("xcrun", [
  "swiftc",
  resolve("scripts/native-click.swift"),
  "-o",
  clickBinary,
]);
const targetSource = join(dir, "target.cjs");
await writeFile(
  targetSource,
  `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(dir, "target-profile"))});
app.whenReady().then(()=>{const w=new BrowserWindow({x:100,y:100,width:400,height:500,frame:false,fullscreenable:false,maximizable:false,acceptFirstMouse:true,title:'Click-through test target',webPreferences:{sandbox:true}});w.loadURL('data:text/html,'+encodeURIComponent('<body style="margin:0"><button id="target" style="width:100vw;height:100vh">Click target beneath overlay</button><script>window.count=0;document.querySelector("button").onclick=()=>window.count++;</script>'));});`,
);
let target, overlayApp;
try {
  target = await electron.launch({ args: [targetSource] });
  const targetPage = await target.firstWindow();
  await targetPage.locator("#target").waitFor();
  await exec(clickBinary, ["300", "350"]);
  await targetPage.waitForFunction(
    () => window.count === 1,
    {},
    { timeout: 3000 },
  );
  await targetPage.evaluate(() => (window.count = 0));
  console.log(
    "PASS native click helper reaches the target app without the overlay.",
  );
  overlayApp = await electron.launch({
    args: [".", "--smoke-test", "--demo"],
    env: {
      ...process.env,
      CHAT_STREAM_TEST_DATA: join(dir, "overlay-profile"),
    },
  });
  const overlay = await overlayApp.firstWindow();
  await overlay.locator("#click-through").waitFor();
  await overlayApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setBounds({ x: 100, y: 100, width: 400, height: 500 });
    w.show();
    w.focus();
  });
  await overlay.waitForFunction(
    () => window.innerWidth === 400 && window.innerHeight === 500,
  );
  const click = () => exec(clickBinary, ["300", "350"]);
  await overlay.evaluate(() =>
    window.chatStream.action({
      type: "settings",
      patch: { clickThrough: false },
    }),
  );
  await click();
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(await targetPage.evaluate(() => window.count), 0);
  console.log(
    "PASS ordinary overlay intercepts native click; underlying app receives none.",
  );
  await overlay.evaluate(() =>
    window.chatStream.action({
      type: "settings",
      patch: { clickThrough: true },
    }),
  );
  await overlay.waitForFunction(
    () =>
      document.querySelector("#click-through").getAttribute("aria-pressed") ===
      "true",
  );
  await new Promise((r) => setTimeout(r, 250));
  await click();
  await targetPage.waitForFunction(
    () => window.count === 1,
    {},
    { timeout: 3000 },
  );
  assert.deepEqual(
    await overlayApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    ),
    { x: 100, y: 100, width: 400, height: 500 },
  );
  console.log(
    "PASS native macOS mouse click reaches a separate application through the floating overlay.",
  );
  await overlayApp.close();
  overlayApp = await electron.launch({
    args: [".", "--smoke-test", "--demo"],
    env: {
      ...process.env,
      CHAT_STREAM_TEST_DATA: join(dir, "overlay-profile"),
    },
  });
  const reopened = await overlayApp.firstWindow();
  await reopened.waitForFunction(
    () =>
      document.querySelector("#click-through")?.getAttribute("aria-pressed") ===
      "false",
  );
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(
    await overlayApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    ),
    { x: 100, y: 100, width: 400, height: 500 },
  );
  await click();
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(await targetPage.evaluate(() => window.count), 1);
  console.log(
    "PASS restart restores an interactive overlay with click-through off.",
  );
  await reopened.evaluate(() =>
    window.chatStream.action({
      type: "settings",
      patch: { clickThrough: true },
    }),
  );
  await overlayApp.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items[0].submenu.items.find((i) => i.label === "Turn click-through OFF")
      .click(),
  );
  await reopened.waitForFunction(
    () =>
      document.querySelector("#click-through").getAttribute("aria-pressed") ===
      "false",
  );
  await new Promise((r) => setTimeout(r, 250));
  await click();
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(await targetPage.evaluate(() => window.count), 1);
  console.log(
    "PASS menu recovery restores mouse interaction with the overlay.",
  );
} finally {
  await overlayApp?.close();
  await target?.close();
}
