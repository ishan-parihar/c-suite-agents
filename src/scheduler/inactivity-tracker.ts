// Inactivity Tracker - Monitors user activity and triggers proactive behavior

import { logger } from "../logger";

export class InactivityTracker {
  private lastActivity: number;
  private thresholdMs: number;
  private inactiveSince?: number;

  constructor(inactivityThresholdMs: number = 60 * 60 * 1000) { // 1 hour default
    this.lastActivity = Date.now();
    this.thresholdMs = inactivityThresholdMs;
  }

  async start() {
    logger.info({ thresholdMs: this.thresholdMs }, "Inactivity tracker started");
    // Record initial activity
    this.recordActivity();
  }

  stop() {
    logger.info("Inactivity tracker stopped");
  }

  recordActivity() {
    const wasInactive = this.isUserInactive();
    this.lastActivity = Date.now();
    
    if (wasInactive) {
      this.inactiveSince = undefined;
      logger.info("User activity resumed");
    }
  }

  isUserInactive(): boolean {
    const inactiveDuration = Date.now() - this.lastActivity;
    const isInactive = inactiveDuration > this.thresholdMs;

    if (isInactive && !this.inactiveSince) {
      this.inactiveSince = Date.now();
      logger.info({ inactiveSince: this.inactiveSince }, "User became inactive");
    }

    return isInactive;
  }

  getInactiveDuration(): number {
    if (!this.inactiveSince) return 0;
    return Date.now() - this.inactiveSince;
  }

  getInactiveDurationFormatted(): string {
    const duration = this.getInactiveDuration();
    const minutes = Math.floor(duration / 60000);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    return `${minutes}m`;
  }

  getLastActivity(): number {
    return this.lastActivity;
  }

  getLastActivityFormatted(): string {
    return new Date(this.lastActivity).toLocaleString();
  }
}
