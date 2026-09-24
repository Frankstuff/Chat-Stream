export type Platform = "twitch" | "youtube";
export interface ChatMessage {
  id: string;
  platform: Platform;
  username: string;
  text: string;
  timestamp: number;
  demo?: boolean;
}
export interface Connection {
  state:
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "waiting"
    | "ended"
    | "error";
  detail: string;
}
export interface Settings {
  opacity: number;
  fontSize: number;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  soundEnabled: boolean;
}
export interface PublicState {
  settings: Settings;
  demo: boolean;
  messages: ChatMessage[];
  connections: Record<Platform, Connection>;
  configured: Record<Platform, boolean>;
  authorized: Record<Platform, boolean>;
  twitchChannel: string;
  youtubeUrl: string;
  shortcutAvailable: boolean;
  toggleShortcutAvailable: boolean;
}
export type SetupPage =
  "twitch" | "googleApi" | "googleConsent" | "googleClient";
export type Action =
  | { type: "setup"; page: SetupPage }
  | { type: "settings"; patch: Partial<Settings> }
  | { type: "demo"; enabled: boolean }
  | { type: "hide" | "show" | "connections" | "clear" | "testSound" }
  | { type: "configureTwitch"; clientId: string; channel: string }
  | { type: "importGoogle" }
  | { type: "connect"; platform: Platform; youtubeUrl?: string }
  | { type: "disconnect" | "forget"; platform: Platform };
export interface Bridge {
  state(): Promise<PublicState>;
  action(action: Action): Promise<{ ok: boolean; error?: string }>;
  subscribe(cb: (state: PublicState) => void): () => void;
}
declare global {
  interface Window {
    chatStream: Bridge;
  }
}
