import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "./lib/prisma.js";
import { checkUrl } from "./monitoring/check-url.js";
import { createRedisConnection } from "./queue/redis.js";
import type { MonitorCheckJob } from "./queue/monitor-queue.js";

const worker = new Worker<MonitorCheckJob>(
  "monitor-checks",
  async (job) => {
    const { monitorId, url } = job.data;

    console.log(`Checking ${url}`);

    const result = await checkUrl(url);

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
      `${url}: ${result.isUp ? "UP" : "DOWN"} (${result.responseTimeMs} ms)`,
    );

    return result;
  },
  {
    connection: createRedisConnection(),
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

async function shutdown() {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("PulseWatch worker started");
