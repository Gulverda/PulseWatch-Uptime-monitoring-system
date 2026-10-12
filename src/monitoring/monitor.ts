import type { CheckResult } from "./check-url.js";

export interface Monitor {
  id: number;
  url: string;
  createdAt: string;
  lastCheck: CheckResult | null;
}
