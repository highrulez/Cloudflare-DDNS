import ipaddr from "ipaddr.js";

export type AddressFamily = "IPV4" | "IPV6";
export interface DetectionAttempt {
  family: AddressFamily;
  provider: string;
  success: boolean;
  address?: string;
  error?: string;
  durationMs: number;
}

export interface DetectionOutcome {
  address?: string;
  attempts: DetectionAttempt[];
}

export const defaultProviders = {
  IPV4: ["https://api4.ipify.org", "https://ipv4.icanhazip.com", "https://v4.ident.me"],
  IPV6: ["https://api6.ipify.org", "https://ipv6.icanhazip.com", "https://v6.ident.me"],
} satisfies Record<AddressFamily, string[]>;

export function parsePublicAddress(value: string, family: AddressFamily): string {
  const candidate = value.trim();
  if (!candidate || candidate.length > 45 || /[<>\s]/.test(candidate)) throw new Error("Provider returned a malformed address");
  let address: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    address = ipaddr.parse(candidate);
  } catch {
    throw new Error("Provider returned an invalid IP address");
  }
  if (family === "IPV4" && address.kind() !== "ipv4") throw new Error("Provider returned the wrong address family");
  if (family === "IPV6" && address.kind() !== "ipv6") throw new Error("Provider returned the wrong address family");
  if (address.range() !== "unicast") throw new Error(`Provider returned a non-public ${address.range()} address`);
  return address.toNormalizedString();
}

export async function detectPublicIp(
  family: AddressFamily,
  providers = defaultProviders[family],
  fetcher: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<DetectionOutcome> {
  const attempts: DetectionAttempt[] = [];
  for (const provider of providers) {
    const started = Date.now();
    try {
      const response = await fetcher(provider, {
        headers: { accept: "text/plain", "user-agent": "Cloudflare-DDNS-Manager/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const address = parsePublicAddress(await response.text(), family);
      attempts.push({ family, provider, success: true, address, durationMs: Date.now() - started });
      return { address, attempts };
    } catch (error) {
      attempts.push({
        family,
        provider,
        success: false,
        error: error instanceof Error ? error.message : "Detection failed",
        durationMs: Date.now() - started,
      });
    }
  }
  return { attempts };
}
