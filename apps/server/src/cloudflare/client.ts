const API = "https://api.cloudflare.com/client/v4";

interface Envelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code: number; message: string }>;
  result_info?: { page: number; total_pages: number };
}

export interface CloudflareZoneDto {
  id: string;
  name: string;
  status: string;
}

export interface CloudflareRecordDto {
  id: string;
  type: "A" | "AAAA";
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
}

export class CloudflareError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

const retryableStatus = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class CloudflareClient {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 8_000,
    private readonly maxAttempts = 4,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<{ data: T; requestId?: string }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetcher(`${API}${path}`, {
          ...init,
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
            ...init.headers,
          },
        });
        const requestId = response.headers.get("cf-ray") ?? undefined;
        const body = (await response.json().catch(() => null)) as Envelope<T> | null;
        if (!response.ok || !body?.success) {
          const message = body?.errors?.map((error) => error.message).join("; ") || `Cloudflare returned HTTP ${response.status}`;
          const retryable = retryableStatus.has(response.status);
          if (retryable && attempt + 1 < this.maxAttempts) {
            const retryAfter = Number(response.headers.get("retry-after"));
            await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : [2_000, 5_000, 10_000][attempt]!);
            continue;
          }
          throw new CloudflareError(message, response.status, requestId, retryable);
        }
        return { data: body.result, ...(requestId ? { requestId } : {}) };
      } catch (error) {
        if (error instanceof CloudflareError) throw error;
        lastError = error;
        if (attempt + 1 < this.maxAttempts) {
          await sleep([2_000, 5_000, 10_000][attempt]! + Math.floor(Math.random() * 250));
          continue;
        }
      }
    }
    throw new CloudflareError(lastError instanceof Error ? lastError.message : "Cloudflare request failed", 0, undefined, true);
  }

  async verifyToken() {
    return (await this.request<{ id: string; status: string }>("/user/tokens/verify")).data;
  }

  async listZones(): Promise<CloudflareZoneDto[]> {
    const zones: CloudflareZoneDto[] = [];
    for (let page = 1; ; page += 1) {
      const response = await this.request<CloudflareZoneDto[]>(`/zones?page=${page}&per_page=50`);
      zones.push(...response.data);
      if (response.data.length < 50) return zones;
    }
  }

  async listRecords(zoneId: string): Promise<CloudflareRecordDto[]> {
    const records: CloudflareRecordDto[] = [];
    for (let page = 1; ; page += 1) {
      const response = await this.request<CloudflareRecordDto[]>(
        `/zones/${encodeURIComponent(zoneId)}/dns_records?type=A%2CAAAA&page=${page}&per_page=100`,
      );
      records.push(...response.data.filter((record) => record.type === "A" || record.type === "AAAA"));
      if (response.data.length < 100) return records;
    }
  }

  async getRecord(zoneId: string, recordId: string) {
    return (await this.request<CloudflareRecordDto>(
      `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
    )).data;
  }

  async createRecord(zoneId: string, input: Omit<CloudflareRecordDto, "id">) {
    return this.request<CloudflareRecordDto>(`/zones/${encodeURIComponent(zoneId)}/dns_records`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async patchRecord(zoneId: string, recordId: string, content: string) {
    return this.request<CloudflareRecordDto>(
      `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
      { method: "PATCH", body: JSON.stringify({ content }) },
    );
  }
}
