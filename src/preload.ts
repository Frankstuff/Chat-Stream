import { contextBridge, ipcRenderer } from "electron";
import type { Action, PublicState, Bridge } from "./shared";
const bridge: Bridge = {
  state: () => ipcRenderer.invoke("chat:state"),
  action: (action: Action) => ipcRenderer.invoke("chat:action", action),
  subscribe: (callback: (state: PublicState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: PublicState) =>
      callback(state);
    ipcRenderer.on("chat:state", listener);
    return () => ipcRenderer.removeListener("chat:state", listener);
  },
};
contextBridge.exposeInMainWorld("chatStream", bridge);
