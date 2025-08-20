// Use built-in fetch from Node/Electron runtime to avoid ESM/CJS interop issues
const fetchFn: any = (globalThis as any).fetch;

export interface HubClientOptions { baseUrl: string; apiKey?: string; adminToken?: string }

export class HubHttpClient {
  constructor(private opts: HubClientOptions) {}
  private headers(extra?: Record<string,string>) {
    const h: Record<string,string> = { 'Content-Type': 'application/json' };
    if (this.opts.apiKey) h['Authorization'] = `Bearer ${this.opts.apiKey}`;
    if (this.opts.adminToken) h['X-Admin-Token'] = this.opts.adminToken;
    return { ...h, ...(extra||{}) };
  }
  async health() {
    const res = await fetchFn(new URL('/healthz', this.opts.baseUrl).toString());
    return res.ok;
  }
  async authCompleteSms(body: any) {
    const res = await fetchFn(new URL('/auth/complete-sms', this.opts.baseUrl).toString(), { method: 'POST', body: JSON.stringify(body), headers: this.headers() });
    const j: any = await res.json().catch(() => ({} as any));
    if (!res.ok) throw new Error(j?.error?.message || JSON.stringify(j));
    return j;
  }
  async channelsCreate(body: any) {
    const res = await fetchFn(new URL('/v1/channels/create', this.opts.baseUrl).toString(), { method: 'POST', body: JSON.stringify(body), headers: this.headers() });
    const j: any = await res.json().catch(() => ({} as any));
    if (!res.ok) throw new Error(j?.error?.message || JSON.stringify(j));
    return j;
  }
  async channelsList() {
    const res = await fetchFn(new URL('/v1/channels/list', this.opts.baseUrl).toString(), { headers: this.headers() });
    const j: any = await res.json().catch(() => ({} as any));
    if (!res.ok) throw new Error(j?.error?.message || JSON.stringify(j));
    return j;
  }
  async publicChannelsList(phone?: string) {
    const url = new URL('/v1/public/channels', this.opts.baseUrl);
    if (phone) url.searchParams.set('phone', phone);
    const res = await fetchFn(url.toString(), { headers: this.headers() });
    const j: any = await res.json().catch(() => ({} as any));
    if (!res.ok) throw new Error(j?.error?.message || JSON.stringify(j));
    return j;
  }
  async publicJoin(shortId: string, phone: string) {
    const res = await fetchFn(new URL(`/v1/public/channels/${shortId}/join`, this.opts.baseUrl).toString(), { method: 'POST', body: JSON.stringify({ phone }), headers: this.headers() });
    const j: any = await res.json().catch(() => ({} as any));
    if (!res.ok) throw new Error(j?.error?.message || JSON.stringify(j));
    return j;
  }
}
