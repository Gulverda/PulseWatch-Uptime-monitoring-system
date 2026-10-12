import Fastify from "fastify";
import type { Monitor } from "./monitoring/monitor.js";
import { checkUrl } from "./monitoring/check-url.js";

const app = Fastify({
  logger: true,
});

const monitors: Monitor[] = [];
let nextMonitorId = 1;

app.get("/health", async () => {
  return {
    status: "ok",
    service: "pulsewatch",
  };
});

app.get("/monitors", async () => {
  return monitors;
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

    const monitor: Monitor = {
      id: nextMonitorId++,
      url: parsedUrl.toString(),
      createdAt: new Date().toISOString(),
      lastCheck: null,
    };

    monitor.lastCheck = await checkUrl(monitor.url);

    monitors.push(monitor);

    return reply.code(201).send(monitor);
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

start();
