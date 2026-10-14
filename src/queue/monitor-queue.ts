import { Queue } from "bullmq";
import { createRedisConnection } from "./redis.js";

export interface MonitorCheckJob {
  monitorId: string;
  url: string;
}

export const monitorQueue = new Queue<MonitorCheckJob>("monitor-checks", {
  connection: createRedisConnection(),
});
