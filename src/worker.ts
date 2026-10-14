import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "./lib/prisma.js";
import { checkUrl } from "./monitoring/check-url.js";
import { createRedisConnection } from "./queue/redis.js";
import type { MonitorCheckJob } from "./queue/monitor-queue.js";

const workerConnection = createRedisConnection();

const worker = new Worker<MonitorCheckJob>(
  "monitor-checks",
  async (job) => {
    const { monitorId, url } = job.data;

    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId },
      select: {
        isActive: true,
        url: true,
      },
    });

    if (!monitor || !monitor.isActive) {
      console.log(`Skipping inactive or deleted monitor: ${monitorId}`);
      return { skipped: true, monitorId };
    }

    const result = await checkUrl(monitor.url);

    // Check again before saving the result.
    const stillActive = await prisma.monitor.findUnique({
      where: { id: monitorId },
      select: { isActive: true },
    });

    if (!stillActive?.isActive) {
      console.log(`Discarding check for inactive monitor: ${monitorId}`);
      return { skipped: true, monitorId };
    }

    await prisma.check.create({
      data: {
        monitorId,
        isUp: result.isUp,
        statusCode: result.statusCode,
        responseTimeMs: result.responseTimeMs,
        error: result.error,
      },
    });

    console.log(
      `${monitor.url}: ${result.isUp ? "UP" : "DOWN"} (${result.responseTimeMs} ms)`,
    );

    return result;
  },
  {
    connection: workerConnection,
    concurrency: 5,
  },
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id} failed:`, error);
});

worker.on("error", (error) => {
  console.error("Worker error:", error);
});

let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  try {
    await worker.close();
    await workerConnection.quit();
    await prisma.$disconnect();

    console.log("PulseWatch worker shut down gracefully");
  } catch (error) {
    console.error("Worker shutdown error:", error);
    process.exitCode = 1;
  }
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

console.log("PulseWatch worker started");
