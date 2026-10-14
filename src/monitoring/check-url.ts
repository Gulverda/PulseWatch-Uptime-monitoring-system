import "dotenv/config";
import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";
import { Agent, fetch } from "undici";
import ipaddr from "ipaddr.js";
import { validateMonitorUrl } from "./validate-url.js";

export interface CheckResult {
  url: string;
  isUp: boolean;
  statusCode: number | null;
  responseTimeMs: number;
  error: string | null;
}

const MAX_REDIRECTS = 5;

function isPublicIp(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

function getErrorDetails(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const details: string[] = [];
  const seen = new Set<Error>();
  let current: unknown = error;

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);

    const code = (current as NodeJS.ErrnoException).code;
    details.push(code ? `${current.message} (code: ${code})` : current.message);

    current = current.cause;
  }

  if (current !== undefined && !(current instanceof Error)) {
    details.push(String(current));
  }

  return details.join(" -> ");
}

function createDnsError(message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), {
    code: "EACCES",
  }) as NodeJS.ErrnoException;
}

async function resolvePublicAddresses(
  hostname: string,
): Promise<LookupAddress[]> {
  const normalizedHostname = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  const ipVersion = isIP(normalizedHostname);

  if (ipVersion !== 0) {
    if (!isPublicIp(normalizedHostname)) {
      throw new Error("Private or reserved IP address blocked");
    }

    return [
      {
        address: normalizedHostname,
        family: ipVersion,
      },
    ];
  }

  const addresses = await lookup(normalizedHostname, {
    all: true,
    verbatim: true,
  });

  if (addresses.length === 0) {
    throw new Error("Hostname did not resolve to any IP addresses");
  }

  // Reject the hostname if ANY returned address is non-public.
  // This prevents selecting a public address from a mixed public/private set.
  if (addresses.some(({ address }) => !isPublicIp(address))) {
    throw new Error("Hostname resolves to a private or reserved IP address");
  }

  return addresses;
}

const secureLookup = (
  hostname: string,
  options: LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void => {
  void resolvePublicAddresses(hostname)
    .then((addresses) => {
      const filteredAddresses =
        options.family && options.family !== 0
          ? addresses.filter((address) => address.family === options.family)
          : addresses;

      if (filteredAddresses.length === 0) {
        const error = Object.assign(
          new Error("No public IP address found for requested family"),
          { code: "ENOTFOUND" },
        ) as NodeJS.ErrnoException;

        callback(error, options.all ? [] : "");
        return;
      }

      if (options.all) {
        callback(null, filteredAddresses);
        return;
      }

      const selected = filteredAddresses[0];

      if (!selected) {
        callback(createDnsError("No public IP address found"), "");
        return;
      }

      callback(null, selected.address, selected.family);
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "DNS validation failed";

      console.error(`[checkUrl] DNS lookup failed for ${hostname}:`, message);

      callback(createDnsError(message), options.all ? [] : "");
    });
};

export async function checkUrl(
  inputUrl: string,
  timeoutMs = 5_000,
): Promise<CheckResult> {
  const startedAt = performance.now();

  let currentUrl: URL;

  try {
    currentUrl = await validateMonitorUrl(inputUrl);
  } catch (error) {
    return {
      url: inputUrl,
      isUp: false,
      statusCode: null,
      responseTimeMs: performance.now() - startedAt,
      error: getErrorDetails(error),
    };
  }

  const dispatcher = new Agent({
    connect: {
      lookup: secureLookup,
    },
  });

  try {
    for (let redirectCount = 0; ; redirectCount++) {
      const response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        dispatcher,
      });
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has("location")
      ) {
        const location = response.headers.get("location");

        await response.body?.cancel();

        if (!location) {
          throw new Error("Redirect location is missing");
        }

        if (redirectCount >= MAX_REDIRECTS) {
          throw new Error("Maximum redirect limit exceeded");
        }

        const nextUrl = new URL(location, currentUrl);

        // Validate every redirect target independently.
        currentUrl = await validateMonitorUrl(nextUrl.toString());
        continue;
      }

      await response.body?.cancel();

      return {
        url: inputUrl,
        isUp: response.status >= 200 && response.status < 400,
        statusCode: response.status,
        responseTimeMs: performance.now() - startedAt,
        error: null,
      };
    }
  } catch (error) {
    const details = getErrorDetails(error);

    console.error(`[checkUrl] Request failed for ${inputUrl}:`, details);

    return {
      url: inputUrl,
      isUp: false,
      statusCode: null,
      responseTimeMs: performance.now() - startedAt,
      error: details,
    };
  } finally {
    await dispatcher.close();
  }
}
