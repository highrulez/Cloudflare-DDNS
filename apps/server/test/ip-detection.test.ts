import { describe, expect, it, vi } from "vitest";
import { detectPublicIp, parsePublicAddress } from "../src/ip/detection.js";

describe("public IP detection", () => {
  it.each(["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.1.1", "224.0.0.1"])(
    "rejects non-public IPv4 %s",
    (address) => expect(() => parsePublicAddress(address, "IPV4")).toThrow(/non-public/),
  );

  it.each(["::1", "fe80::1", "fc00::1", "ff02::1"])(
    "rejects non-public IPv6 %s",
    (address) => expect(() => parsePublicAddress(address, "IPV6")).toThrow(/non-public/),
  );

  it("normalizes public IPv4 and IPv6", () => {
    expect(parsePublicAddress(" 1.1.1.1\n", "IPV4")).toBe("1.1.1.1");
    expect(parsePublicAddress("2606:4700:4700::1111", "IPV6")).toBe("2606:4700:4700:0:0:0:0:1111");
  });

  it("falls back after invalid provider output", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("<html>nope</html>"))
      .mockResolvedValueOnce(new Response("8.8.8.8"));
    const result = await detectPublicIp("IPV4", ["https://one.test", "https://two.test"], fetcher);
    expect(result.address).toBe("8.8.8.8");
    expect(result.attempts.map(({ success }) => success)).toEqual([false, true]);
  });
});
