import { performance } from "node:perf_hooks";

export interface CheckResult {
  url: string;
  isUp: boolean;
  statusCode: number | null;
  responseTimeMs: number;
  error: string | null;
}

export async function checkUrl(
  url: string,
  timeoutMs = 5000,
): Promise<CheckResult> {
  const startTime = performance.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });

    const responseTimeMs = Number((performance.now() - startTime).toFixed(2));

    return {
      url,
      isUp: response.status >= 200 && response.status < 400,
      statusCode: response.status,
      responseTimeMs,
      error: response.status >= 400 ? `HTTP ${response.status}` : null,
    };
  } catch (error) {
    const responseTimeMs = Number((performance.now() - startTime).toFixed(2));

    return {
      url,
      isUp: false,
      statusCode: null,
      responseTimeMs,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
