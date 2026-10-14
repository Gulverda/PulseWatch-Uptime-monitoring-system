import Fastify from "fastify";
import { prisma } from "./lib/prisma.js";
import { monitorQueue } from "./queue/monitor-queue.js";

const app = Fastify({
  logger: true,
});

app.get("/health", async () => {
  return {
    status: "ok",
    service: "pulsewatch",
  };
});

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
      parsedUrl = new URL(request.body.url);
    } catch {
      return reply.code(400).send({
        error: "Invalid URL",
      });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return reply.code(400).send({
        error: "Only HTTP and HTTPS URLs are allowed",
      });
    }

    const monitor = await prisma.monitor.create({
      data: {
        url: parsedUrl.toString(),
      },
    });

    await monitorQueue.add("check-monitor", {
      monitorId: monitor.id,
      url: monitor.url,
    });

    return reply.code(202).send({
      message: "Monitor created; check queued",
      monitor,
    });
  },
);

const start = async () => {
  try {
    await app.listen({
      port: 3000,
      host: "127.0.0.1",
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
