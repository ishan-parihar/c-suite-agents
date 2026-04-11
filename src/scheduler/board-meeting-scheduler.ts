// Board Meeting Scheduler — Daily meeting trigger
// Fires the daily board meeting at configured cron time.
// The engine (board-meeting.ts) handles everything complex.

import { logger } from "../logger";
import { loadConfig } from "../config/loader";
import { CronExpressionParser } from "cron-parser";

let boardMeetingScheduler: BoardMeetingScheduler | null = null;

export class BoardMeetingScheduler {
  private running = false;
  private checkIntervalMs = 60000; // Check every minute
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastFiredDate: string | null = null;

  async start(): Promise<void> {
    if (this.running) {
      logger.warn("Board meeting scheduler already running");
      return;
    }

    const config = loadConfig();
    const bmConfig = config.boardMeeting;
    if (!bmConfig?.enabled) {
      logger.info("Board meeting scheduler disabled by config");
      return;
    }

    this.running = true;
    logger.info({ cronExpression: bmConfig.cronExpression }, "Board meeting scheduler started");

    const loop = async () => {
      if (!this.running) return;

      try {
        await this.checkAndFire();
      } catch (err: any) {
        logger.error({ err: err.message }, "Board meeting scheduler check failed");
      }

      this.timer = setTimeout(loop, this.checkIntervalMs);
      this.timer.unref();
    };

    loop();
  }

  private async checkAndFire(): Promise<void> {
    try {
      const config = loadConfig();
      const bmConfig = config.boardMeeting;
      if (!bmConfig?.enabled) return;

      const interval = CronExpressionParser.parse(bmConfig.cronExpression, {
        tz: "Asia/Kolkata",
      });
      const nextFireTime = interval.next().getTime();
      const now = Date.now();

      // Check if we should fire (next scheduled time is within the next check interval and hasn't passed)
      const shouldFire = (nextFireTime - now) < this.checkIntervalMs && nextFireTime > now;
      const today = new Date().toISOString().split("T")[0];

      if (shouldFire && this.lastFiredDate !== today) {
        this.lastFiredDate = today;
        logger.info("Board meeting triggered by scheduler");

        const { runFullBoardMeeting } = await import("../organic/board-meeting");

        const meeting = await runFullBoardMeeting();

        if (meeting && meeting.report) {
          try {
            const { deliverMeetingReport } = await import("../integrations/telegram");
            const delivered = await deliverMeetingReport(meeting.report, meeting.id);
            if (delivered) {
              logger.info({ meetingId: meeting.id }, "Board meeting report delivered to Telegram");
            } else {
              logger.warn({ meetingId: meeting.id }, "Board meeting report delivery returned false");
            }
          } catch (err: any) {
            logger.error({ meetingId: meeting?.id, err: err.message }, "Failed to deliver board report to Telegram");
          }
        } else {
          logger.warn({ meetingId: meeting?.id }, "Board meeting completed but no report was generated");
        }
      }
    } catch (err: any) {
      logger.error({ err: err.message }, "Board meeting scheduler check failed");
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info("Board meeting scheduler stopped");
  }

  isRunning(): boolean {
    return this.running;
  }
}

export async function startBoardMeetingScheduler(): Promise<BoardMeetingScheduler | null> {
  if (!boardMeetingScheduler) {
    boardMeetingScheduler = new BoardMeetingScheduler();
    await boardMeetingScheduler.start();
  }
  return boardMeetingScheduler;
}

export function getBoardMeetingScheduler(): BoardMeetingScheduler | null {
  return boardMeetingScheduler;
}
