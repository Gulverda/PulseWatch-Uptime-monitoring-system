import Fastify from "fastify";
import { prisma } from "./lib/prisma.js";
import { monitorQueue, monitorQueueConnection } from "./queue/monitor-queue.js";
import {
  scheduleMonitor,
  unscheduleMonitor,
} from "./queue/schedule-monitor.js";
import { validateMonitorUrl } from "./monitoring/validate-url.js";

const app = Fastify({
  logger: true,
});

app.get("/health", async () => {
  return {
    status: "ok",
    service: "pulsewatch",
  };
});

app.patch<{ Params: { id: string } }>(
  "/monitors/:id/pause",
  async (request, reply) => {
    const { id } = request.params;

    const monitor = await prisma.monitor.findUnique({
      where: { id },
    });

    if (!monitor) {
      return reply.code(404).send({
        error: "Monitor not found",
      });
    }

    if (!monitor.isActive) {
      return reply.code(200).send({
        message: "Monitor is already paused",
        monitor,
      });
    }

    await prisma.monitor.update({
      where: { id },
      data: { isActive: false },
    });

    await unscheduleMonitor(id);

    return reply.code(200).send({
      message: "Monitor paused",
      monitorId: id,
    });
  },
);

app.patch<{ Params: { id: string } }>(
  "/monitors/:id/resume",
  async (request, reply) => {
    const { id } = request.params;

    const monitor = await prisma.monitor.findUnique({
      where: { id },
    });

    if (!monitor) {
      return reply.code(404).send({
        error: "Monitor not found",
      });
    }

    if (monitor.isActive) {
      return reply.code(200).send({
        message: "Monitor is already active",
        monitor,
      });
    }

    await prisma.monitor.update({
      where: { id },
      data: { isActive: true },
    });

    await scheduleMonitor(monitor.id, monitor.url);

    await monitorQueue.add(
      "check-monitor",
      {
        monitorId: monitor.id,
        url: monitor.url,
      },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    return reply.code(200).send({
      message: "Monitor resumed; check queued",
      monitorId: id,
    });
  },
);

app.delete<{ Params: { id: string } }>(
  "/monitors/:id",
  async (request, reply) => {
    const { id } = request.params;

    const monitor = await prisma.monitor.findUnique({
      where: { id },
    });

    if (!monitor) {
      return reply.code(404).send({
        error: "Monitor not found",
      });
    }

    await unscheduleMonitor(id);

    await prisma.monitor.delete({
      where: { id },
    });

    return reply.code(200).send({
      message: "Monitor deleted",
      monitorId: id,
    });
  },
);

app.get("/monitors", async () => {
  return prisma.monitor.findMany({
    include: {
      checks: {
        orderBy: {
          checkedAt: "desc",
        },
        take: 1,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
});

app.post<{
  Body: { url: string };
}>(
  "/monitors",
  {
    schema: {
      body: {
        type: "object",
        required: ["url"],
        additionalProperties: false,
        properties: {
          url: {
            type: "string",
            minLength: 1,
          },
        },
      },
    },
  },
  async (request, reply) => {
    let parsedUrl: URL;

    try {
      parsedUrl = await validateMonitorUrl(request.body.url);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Invalid URL",
      });
    }

    const monitor = await prisma.monitor.create({
      data: {
        url: parsedUrl.toString(),
      },
    });

    try {
      // Queue the initial check immediately.
      await monitorQueue.add(
        "check-monitor",
        {
          monitorId: monitor.id,
          url: monitor.url,
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1_000,
          },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );

      // Schedule recurring checks every 60 seconds.
      await scheduleMonitor(monitor.id, monitor.url);
    } catch (error) {
      request.log.error(
        { error, monitorId: monitor.id },
        "Failed to queue or schedule monitor",
      );

      return reply.code(503).send({
        error: "Monitor was created, but scheduling failed",
        monitorId: monitor.id,
      });
    }

    return reply.code(202).send({
      message: "Monitor created; check queued and scheduled",
      monitor,
    });
  },
);

const start = async () => {
  try {
    const activeMonitors = await prisma.monitor.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        url: true,
      },
    });

    await Promise.all(
      activeMonitors.map((monitor) => scheduleMonitor(monitor.id, monitor.url)),
    );

    app.log.info(`Scheduled ${activeMonitors.length} active monitors`);

    await app.listen({
      port: 3000,
      host: "127.0.0.1",
    });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
};

let isShuttingDown = false;

const shutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  try {
    await app.close();
    await monitorQueue.close();
    await monitorQueueConnection.quit();
    await prisma.$disconnect();

    app.log.info("PulseWatch API shut down gracefully");
  } catch (error) {
    app.log.error(error, "Error during shutdown");
    process.exitCode = 1;
  }
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

void start();
