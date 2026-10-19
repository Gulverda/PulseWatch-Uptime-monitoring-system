import { describe, expect, it } from "vitest";
import { validateMonitorUrl } from "./validate-url.js";

describe("validateMonitorUrl", () => {
  it("rejects a malformed URL", async () => {
    await expect(validateMonitorUrl("not a url")).rejects.toThrow(
      "Invalid URL",
    );
  });

  it("rejects non-HTTP protocols", async () => {
    await expect(validateMonitorUrl("ftp://example.com")).rejects.toThrow(
      "Only HTTP and HTTPS URLs are allowed",
    );
  });

  it("rejects URLs with credentials", async () => {
    await expect(
      validateMonitorUrl("https://user:pass@example.com"),
    ).rejects.toThrow("URLs containing credentials are not allowed");
  });

  it.each(["http://localhost", "http://api.localhost", "http://db.internal"])(
    "rejects local hostname %s",
    async (url) => {
      await expect(validateMonitorUrl(url)).rejects.toThrow(
        "Local hostnames are not allowed",
      );
    },
  );

  it.each([
    "http://127.0.0.1",
    "http://10.0.0.5",
    "http://192.168.1.1",
    "http://169.254.169.254",
    "http://[::1]",
  ])("rejects private or reserved IP %s", async (url) => {
    await expect(validateMonitorUrl(url)).rejects.toThrow(
      "Private or reserved IP addresses are not allowed",
    );
  });

  it("accepts a public IP address", async () => {
    const url = await validateMonitorUrl("https://1.1.1.1/health");
    expect(url.hostname).toBe("1.1.1.1");
  });
});
