import Fastify from "fastify";
import { prisma } from "./lib/prisma.js";
import { monitorQueue, monitorQueueConnection } from "./queue/monitor-queue.js";
import {
  scheduleMonitor,
  unscheduleMonitor,
} from "./queue/schedule-monitor.js";
import { validateMonitorUrl } from "./monitoring/validate-url.js";
import rateLimit from "@fastify/rate-limit";

const app = Fastify({
  logger: true,
  ajv: {
    customOptions: {
      removeAdditional: false,
    },
  },
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(
    {
      err: error,
      url: request.url,
      method: request.method,
    },
    "Request failed",
  );

  const isError = error instanceof Error;

  const statusCode =
    isError && "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : 500;

  if (statusCode >= 400 && statusCode < 500) {
    return reply.code(statusCode).send({
      error: isError ? error.name : "Request Error",
      message: isError ? error.message : "Invalid request",
    });
  }

  return reply.code(500).send({
    error: "Internal Server Error",
    message: "An unexpected error occurred",
  });
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

app.get(
  "/health",
  {
    config: {
      rateLimit: false,
    },
  },
  async () => {
    return {
      status: "ok",
      service: "pulsewatch",
    };
  },
);

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

    await scheduleMonitor(monitor.id, monitor.url, monitor.intervalSeconds);

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

app.get<{ Params: { id: string } }>("/monitors/:id", async (request, reply) => {
  const monitor = await prisma.monitor.findUnique({
    where: { id: request.params.id },
    include: {
      checks: {
        orderBy: { checkedAt: "desc" },
        take: 1,
      },
    },
  });

  if (!monitor) {
    return reply.code(404).send({
      error: "Monitor not found",
    });
  }

  const { checks, ...monitorDetails } = monitor;

  return {
    ...monitorDetails,
    latestCheck: checks[0] ?? null,
  };
});

app.get<{
  Params: { id: string };
  Querystring: {
    limit?: number;
    offset?: number;
  };
}>(
  "/monitors/:id/checks",
  {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 20,
          },
          offset: {
            type: "integer",
            minimum: 0,
            default: 0,
          },
        },
      },
    },
  },
  async (request, reply) => {
    const { id } = request.params;
    const limit = request.query.limit ?? 20;
    const offset = request.query.offset ?? 0;

    const monitor = await prisma.monitor.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!monitor) {
      return reply.code(404).send({
        error: "Monitor not found",
      });
    }

    const [checks, total] = await Promise.all([
      prisma.check.findMany({
        where: { monitorId: id },
        orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
        take: limit,
        skip: offset,
      }),
      prisma.check.count({
        where: { monitorId: id },
      }),
    ]);

    return {
      items: checks,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + checks.length < total,
      },
    };
  },
);

app.get<{ Params: { id: string } }>(
  "/monitors/:id/stats",
  async (request, reply) => {
    const { id } = request.params;

    const monitor = await prisma.monitor.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!monitor) {
      return reply.code(404).send({
        error: "Monitor not found",
      });
    }

    const now = new Date();

    const windows = [
      {
        key: "last24Hours",
        since: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
      {
        key: "last7Days",
        since: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      },
    ] as const;

    const stats = await Promise.all(
      windows.map(async ({ key, since }) => {
        const [aggregate, successfulChecks, failedChecks] = await Promise.all([
          prisma.check.aggregate({
            where: {
              monitorId: id,
              checkedAt: { gte: since, lte: now },
            },
            _count: { _all: true },
            _avg: { responseTimeMs: true },
          }),

          prisma.check.count({
            where: {
              monitorId: id,
              isUp: true,
              checkedAt: { gte: since, lte: now },
            },
          }),

          prisma.check.count({
            where: {
              monitorId: id,
              isUp: false,
              checkedAt: { gte: since, lte: now },
            },
          }),
        ]);

        const totalChecks = aggregate._count._all;

        return {
          [key]: {
            totalChecks,
            successfulChecks,
            failedChecks,
            uptimePercentage:
              totalChecks > 0
                ? Number(((successfulChecks / totalChecks) * 100).toFixed(2))
                : null,
            averageResponseTimeMs:
              aggregate._avg.responseTimeMs !== null
                ? Number(aggregate._avg.responseTimeMs.toFixed(2))
                : null,
          },
        };
      }),
    );

    return {
      monitorId: id,
      generatedAt: now.toISOString(),
      ...Object.assign({}, ...stats),
    };
  },
);

app.patch<{
  Params: { id: string };
  Body: { intervalSeconds: number };
}>(
  "/monitors/:id/interval",
  {
    schema: {
      body: {
        type: "object",
        required: ["intervalSeconds"],
        additionalProperties: false,
        properties: {
          intervalSeconds: {
            type: "integer",
            enum: [30, 60, 300],
          },
        },
      },
    },
  },
  async (request, reply) => {
    const { id } = request.params;
    const { intervalSeconds } = request.body;

    const monitor = await prisma.monitor.findUnique({
      where: { id },
    });

    if (!monitor) {
      return reply.code(404).send({
        error: "Monitor not found",
      });
    }

    const updatedMonitor = await prisma.monitor.update({
      where: { id },
      data: { intervalSeconds },
    });

    if (updatedMonitor.isActive) {
      await scheduleMonitor(
        updatedMonitor.id,
        updatedMonitor.url,
        updatedMonitor.intervalSeconds,
      );
    }

    return reply.code(200).send({
      message: "Monitor interval updated",
      monitor: updatedMonitor,
    });
  },
);

app.post<{
  Body: {
    url: string;
    intervalSeconds?: 30 | 60 | 300;
  };
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
          intervalSeconds: {
            type: "integer",
            enum: [30, 60, 300],
          },
        },
      },
    },
  },
  async (request, reply) => {
    const intervalSeconds = request.body.intervalSeconds ?? 60;

    let parsedUrl: URL;

    try {
      parsedUrl = await validateMonitorUrl(request.body.url);
    } catch (error) {
      return reply.code(400).send({
        error: "Invalid URL",
        message:
          error instanceof Error
            ? error.message
            : "The provided URL is invalid",
      });
    }

    const monitor = await prisma.monitor.create({
      data: {
        url: parsedUrl.toString(),
        intervalSeconds,
      },
    });

    try {
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

      await scheduleMonitor(monitor.id, monitor.url, monitor.intervalSeconds);
    } catch (error) {
      request.log.error(
        { err: error, monitorId: monitor.id },
        "Failed to queue or schedule monitor",
      );

      return reply.code(503).send({
        error: "Scheduling Failed",
        message: "Monitor was created, but scheduling failed",
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
      where: { isActive: true },
      select: {
        id: true,
        url: true,
        intervalSeconds: true,
      },
    });

    await Promise.all(
      activeMonitors.map((monitor) =>
        scheduleMonitor(monitor.id, monitor.url, monitor.intervalSeconds),
      ),
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
