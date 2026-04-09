export class AsyncMutex {
  private locks = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    const prev = this.locks.get(key) || Promise.resolve();
    let release: () => void;
    const lock = new Promise<void>((r) => { release = r; });
    this.locks.set(key, lock);
    await prev;
    return () => release!();
  }

  cleanup(): void {
    // Remove resolved locks (best-effort)
    if (this.locks.size > 100) {
      this.locks.clear();
    }
  }
}
