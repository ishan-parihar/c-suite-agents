// Meeting Scheduler - Automatically executes scheduled meetings

import { logger } from "../logger.js";
import { getMeetingGovernance } from "../organic/meetings.js";

export class MeetingScheduler {
  private intervalMs: number;
  private running = false;

  constructor(intervalMs: number = 60000) { // Check every minute by default
    this.intervalMs = intervalMs;
  }

  async start() {
    if (this.running) {
      logger.warn("Meeting scheduler already running");
      return;
    }

    this.running = true;
    logger.info({ intervalMs: this.intervalMs }, "Meeting scheduler started");

    const loop = async () => {
      if (!this.running) return;

      try {
        const governance = getMeetingGovernance();
        const executed = await governance.checkAndExecuteMeetings();
        
        if (executed > 0) {
          logger.info({ executed }, "Meetings executed");
        }
      } catch (err: any) {
        logger.error({ err: err.message }, "Meeting scheduler error");
      }

      this.meetingTimer = setTimeout(loop, this.intervalMs);
    };

    loop();
  }

  private meetingTimer: ReturnType<typeof setTimeout> | null = null;

  stop() {
    this.running = false;
    if (this.meetingTimer) {
      clearTimeout(this.meetingTimer);
      this.meetingTimer = null;
    }
    logger.info("Meeting scheduler stopped");
  }
}

let meetingScheduler: MeetingScheduler | null = null;

export async function startMeetingScheduler(intervalMs?: number) {
  if (!meetingScheduler) {
    meetingScheduler = new MeetingScheduler(intervalMs);
    await meetingScheduler.start();
  }
  return meetingScheduler;
}

export function getMeetingScheduler(): MeetingScheduler | null {
  return meetingScheduler;
}
