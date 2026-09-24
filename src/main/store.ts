import { app, safeStorage } from "electron";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import type { Settings } from "../shared";
import { settingsPatch } from "./core";
export interface Token {
  access_token: string;
  refresh_token?: string;
  expiresAt: number;
}
export interface Secrets {
  twitchClientId?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  twitch?: Token;
  youtube?: Token;
}
export class Store {
  secrets: Secrets = {};
  prefs: {
    settings: Settings;
    twitchChannel: string;
    youtubeUrl: string;
    bounds?: Electron.Rectangle;
  } = {
    settings: {
      opacity: 0.94,
      fontSize: 16,
      alwaysOnTop: true,
      clickThrough: false,
      soundEnabled: true,
    },
    twitchChannel: "",
    youtubeUrl: "",
  };
  private root = app.getPath("userData");
  constructor() {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const prefs = join(this.root, "settings.json"),
      vault = join(this.root, "credentials.enc");
    if (existsSync(prefs))
      try {
        const saved = JSON.parse(readFileSync(prefs, "utf8"));
        Object.assign(this.prefs.settings, settingsPatch(saved.settings || {}));
        if (typeof saved.twitchChannel === "string")
          this.prefs.twitchChannel = saved.twitchChannel;
        if (typeof saved.youtubeUrl === "string")
          this.prefs.youtubeUrl = saved.youtubeUrl;
        const b = saved.bounds;
        if (
          b &&
          ["x", "y", "width", "height"].every((k) => Number.isFinite(b[k])) &&
          b.width >= 320 &&
          b.height >= 360
        )
          this.prefs.bounds = b;
      } catch {
        /* recover defaults */
      }
    // Start with an interactive overlay so it can always be moved and adjusted.
    this.prefs.settings.clickThrough = false;
    if (existsSync(vault)) {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error(
          "macOS Keychain is unavailable. Unlock it and restart Chat Stream.",
        );
      try {
        this.secrets = JSON.parse(
          safeStorage.decryptString(readFileSync(vault)),
        );
      } catch {
        throw new Error(
          "Could not unlock saved credentials. Unlock your macOS Keychain and restart.",
        );
      }
    }
  }
  saveSecrets() {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error(
        "macOS Keychain is unavailable; credentials were not saved.",
      );
    this.atomic(
      "credentials.enc",
      safeStorage.encryptString(JSON.stringify(this.secrets)),
    );
  }
  savePrefs() {
    this.atomic("settings.json", JSON.stringify(this.prefs));
  }
  private atomic(name: string, data: string | Buffer) {
    const target = join(this.root, name);
    writeFileSync(target + ".tmp", data, { mode: 0o600 });
    renameSync(target + ".tmp", target);
  }
}
