import { Redis } from "ioredis";

export function createRedisConnection() {
  return new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: null,
  });
}
