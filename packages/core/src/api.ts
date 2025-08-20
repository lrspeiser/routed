export type SessionState = 'unauthenticated' | 'verifying' | 'authenticated';

export interface SessionInfo {
  state: SessionState;
  user?: { id: string; phone: string } | null;
  deviceId?: string | null;
}

export interface AuthAPI {
  requestVerificationCode(input: { phone: string }): Promise<{ requestId: string }>;
  verifyCode(input: { requestId: string; code: string; deviceName?: string; devicePublicJwk?: any }): Promise<{ user: { id: string; phone: string }; deviceId: string }>;
  session(): Promise<SessionInfo>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
}

export interface DeveloperAPI {
  getDeveloper(): Promise<{ tenantId?: string; apiKey?: string; hubUrl?: string }>;
  ensureDeveloper(): Promise<{ tenantId: string; apiKey: string; hubUrl: string }>;
  setHubUrl(input: { hubUrl: string }): Promise<void>;
}

export interface ChannelsAPI {
  createChannel(input: { name: string; visibility: 'public' | 'private'; description?: string }): Promise<{ shortId: string }>;
  listChannels(): Promise<{ channels: Array<{ short_id: string; name: string; description?: string; allow_public: boolean }> }>;
  publicList(input: { phone?: string }): Promise<{ channels: Array<{ short_id: string; name: string; description?: string; allow_public: boolean }> }>;
  subscribePhone(input: { shortId: string; phone: string }): Promise<void>;
  unsubscribePhone(input: { shortId: string; phone: string }): Promise<void>;
}

export interface ServiceAPI {
  auth: AuthAPI;
  developer: DeveloperAPI;
  channels: ChannelsAPI;
}

