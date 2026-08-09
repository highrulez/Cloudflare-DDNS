import ipaddr from 'ipaddr.js';

export type AddressFamily = 'IPV4' | 'IPV6';
export type DetectionStatus =
  'DETECTED' | 'NETWORK_UNAVAILABLE' | 'PROVIDER_FAILED' | 'NO_GLOBAL_ADDRESS';
export type DetectionFailureKind = Exclude<DetectionStatus, 'DETECTED'>;
export interface DetectionAttempt {
  family: AddressFamily;
  provider: string;
  success: boolean;
  address?: string;
  error?: string;
  errorCode?: string;
  failureKind?: DetectionFailureKind;
  durationMs: number;
}

export interface DetectionOutcome {
  address?: string;
  status: DetectionStatus;
  attempts: DetectionAttempt[];
}

export const defaultProviders = {
  IPV4: ['https://api4.ipify.org', 'https://checkip.amazonaws.com', 'https://ipv4.icanhazip.com'],
  IPV6: ['https://api6.ipify.org', 'https://ipv6.icanhazip.com', 'https://v6.ident.me']
} satisfies Record<AddressFamily, string[]>;

const unavailableCodes = new Set([
  'EADDRNOTAVAIL',
  'EAFNOSUPPORT',
  'ENETDOWN',
  'ENETUNREACH',
  'EHOSTDOWN',
  'EHOSTUNREACH'
]);

function detectionError(error: unknown): {
  message: string;
  errorCode?: string;
  failureKind: DetectionFailureKind;
} {
  const value = error instanceof Error ? error : new Error('Detection failed');
  const cause =
    value.cause && typeof value.cause === 'object'
      ? (value.cause as { code?: unknown; message?: unknown })
      : undefined;
  const errorCode =
    typeof cause?.code === 'string'
      ? cause.code
      : 'code' in value && typeof value.code === 'string'
        ? value.code
        : undefined;
  const causeMessage = typeof cause?.message === 'string' ? cause.message : undefined;
  const message = [errorCode, causeMessage ?? value.message].filter(Boolean).join(': ');
  const failureKind =
    errorCode && unavailableCodes.has(errorCode)
      ? 'NETWORK_UNAVAILABLE'
      : /non-public/i.test(value.message)
        ? 'NO_GLOBAL_ADDRESS'
        : 'PROVIDER_FAILED';
  return { message, ...(errorCode ? { errorCode } : {}), failureKind };
}

export function parsePublicAddress(value: string, family: AddressFamily): string {
  const candidate = value.trim();
  if (!candidate || candidate.length > 45 || /[<>\s]/.test(candidate))
    throw new Error('Provider returned a malformed address');
  let address: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    address = ipaddr.parse(candidate);
  } catch {
    throw new Error('Provider returned an invalid IP address');
  }
  if (family === 'IPV4' && address.kind() !== 'ipv4')
    throw new Error('Provider returned the wrong address family');
  if (family === 'IPV6' && address.kind() !== 'ipv6')
    throw new Error('Provider returned the wrong address family');
  if (address.range() !== 'unicast')
    throw new Error(`Provider returned a non-public ${address.range()} address`);
  return address.toNormalizedString();
}

export async function detectPublicIp(
  family: AddressFamily,
  providers = defaultProviders[family],
  fetcher: typeof fetch = fetch,
  timeoutMs = 5_000
): Promise<DetectionOutcome> {
  const attempts: DetectionAttempt[] = [];
  for (const provider of providers) {
    const started = Date.now();
    try {
      const response = await fetcher(provider, {
        headers: { accept: 'text/plain', 'user-agent': 'Cloudflare-DDNS-Manager/1.0' },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const address = parsePublicAddress(await response.text(), family);
      attempts.push({ family, provider, success: true, address, durationMs: Date.now() - started });
      return { address, status: 'DETECTED', attempts };
    } catch (error) {
      const detail = detectionError(error);
      attempts.push({
        family,
        provider,
        success: false,
        error: detail.message,
        ...(detail.errorCode ? { errorCode: detail.errorCode } : {}),
        failureKind: detail.failureKind,
        durationMs: Date.now() - started
      });
    }
  }
  const status =
    attempts.length > 0 &&
    attempts.every((attempt) => attempt.failureKind === 'NETWORK_UNAVAILABLE')
      ? 'NETWORK_UNAVAILABLE'
      : attempts.some((attempt) => attempt.failureKind === 'NO_GLOBAL_ADDRESS')
        ? 'NO_GLOBAL_ADDRESS'
        : 'PROVIDER_FAILED';
  return { status, attempts };
}
