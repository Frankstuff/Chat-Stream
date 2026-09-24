import type { ChatMessage } from "../shared";

export class MessageSounds {
  private lastPlayed = -Infinity;

  constructor(
    private play: () => void,
    private now = () => performance.now(),
  ) {}

  notify(message: ChatMessage, enabled: boolean, connectedAt: number) {
    // YouTube can replay chat history when a connection first opens.
    if (!enabled || message.timestamp < connectedAt) return;
    this.preview();
  }

  preview() {
    const now = this.now();
    // Messages arriving together share an alert instead of overlapping sounds.
    if (now - this.lastPlayed < 750) return;
    this.lastPlayed = now;
    this.play();
  }
}
