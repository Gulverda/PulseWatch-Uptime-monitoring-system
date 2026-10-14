import { monitorQueue } from "./monitor-queue.js";

export interface MonitorCheckJob {
  monitorId: string;
  url: string;
}

export async function scheduleMonitor(
  monitorId: string,
  url: string,
): Promise<void> {
  await monitorQueue.upsertJobScheduler(
    `monitor-${monitorId}`,
    { every: 60_000 },
    {
      name: "check-monitor",
      data: { monitorId, url },
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    },
  );
}

export async function unscheduleMonitor(monitorId: string): Promise<void> {
  await monitorQueue.removeJobScheduler(`monitor-${monitorId}`);
}
