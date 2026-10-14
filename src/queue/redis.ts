import IORedis from "ioredis";

export function createRedisConnection() {
  return new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: null,
  });
}
