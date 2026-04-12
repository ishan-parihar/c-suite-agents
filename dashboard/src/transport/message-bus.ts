type Handler = (event: unknown) => void;

export class MessageBus {
  private handlers = new Map<string, Set<Handler>>();

  subscribe(eventType: string, handler: Handler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    return () => this.handlers.get(eventType)?.delete(handler);
  }

  publish(eventType: string, event: unknown): void {
    const typeHandlers = this.handlers.get(eventType);
    if (!typeHandlers) return;
    for (const handler of typeHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`[MessageBus] Handler error for ${eventType}:`, err);
      }
    }
  }
}

// Singleton
let busInstance: MessageBus | null = null;

export function getMessageBus(): MessageBus {
  if (!busInstance) {
    busInstance = new MessageBus();
  }
  return busInstance;
}

export function resetMessageBus(): void {
  busInstance = null;
}
