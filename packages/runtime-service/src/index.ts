// Use runtime relative require so the packaged app can resolve inside app.asar
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HubHttpClient } = require('../../adapters/hub-http/dist/index.js');
import type { ServiceAPI, SessionInfo } from "@routed/core/dist/api";
import { app, ipcMain } from "electron";
import * as fs from "fs";
import * as path from "path";

function userDataPath(...segs: string[]) {
  try { return path.join(app.getPath('userData'), ...segs); } catch { return path.join(process.cwd(), ...segs); }
}

function readJson(file: string) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function writeJson(file: string, data: any) { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch {} }

export function createRuntimeService(baseUrl: string): ServiceAPI {
  const client = new HubHttpClient({ baseUrl });
  const sessionFile = userDataPath('session.json');
  const devFile = userDataPath('dev.json');

  async function getSession(): Promise<SessionInfo> {
    const s = readJson(sessionFile) || {};
    if (!s.user) return { state: 'unauthenticated' };
    return { state: 'authenticated', user: s.user, deviceId: s.deviceId };
  }

  return {
    auth: {
      async requestVerificationCode({ phone }) {
        // In this MVP, we immediately complete SMS (server sends/validates externally)
        const reqId = 'req-' + Math.random().toString(36).slice(2);
        return { requestId: reqId };
      },
      async verifyCode({ requestId, code, deviceName, devicePublicJwk }) {
        const res = await client.authCompleteSms({ phone: readJson(sessionFile)?.pendingPhone || '', deviceName, devicePublicJwk });
        writeJson(sessionFile, { user: res.user, deviceId: res.deviceId, accessToken: res.accessToken });
        return { user: res.user, deviceId: res.deviceId };
      },
      async session() { return getSession(); },
      async logout() { writeJson(sessionFile, {}); },
      async logoutAll() { writeJson(sessionFile, {}); }
    },
    developer: {
      async getDeveloper() { return readJson(devFile) || {}; },
      async ensureDeveloper() {
        // Provision via public dev sandbox for MVP
        const ok = await client.health();
        if (!ok) throw new Error('hub_unreachable');
        const dev = readJson(devFile) || { hubUrl: baseUrl };
        writeJson(devFile, dev);
        return { tenantId: dev.tenantId || '', apiKey: dev.apiKey || '', hubUrl: dev.hubUrl };
      },
      async setHubUrl({ hubUrl }) {
        const dev = readJson(devFile) || {};
        dev.hubUrl = hubUrl;
        writeJson(devFile, dev);
      }
    },
    channels: {
      async createChannel({ name, visibility, description }) {
        const dev = readJson(devFile) || {};
        const authedClient = new HubHttpClient({ baseUrl: dev.hubUrl || baseUrl, apiKey: dev.apiKey });
        const res = await authedClient.channelsCreate({ name, allow_public: visibility === 'public', description });
        return { shortId: res.short_id };
      },
      async listChannels() {
        const dev = readJson(devFile) || {};
        const authedClient = new HubHttpClient({ baseUrl: dev.hubUrl || baseUrl, apiKey: dev.apiKey });
        const res: any = await authedClient.channelsList();
        const channels = (res && Array.isArray(res.channels)) ? res.channels : (Array.isArray(res) ? res : []);
        return { channels };
      },
      async publicList({ phone }) {
        const res: any = await client.publicChannelsList(phone);
        const channels = (res && Array.isArray(res.channels)) ? res.channels : (Array.isArray(res) ? res : []);
        return { channels };
      },
      async subscribePhone({ shortId, phone }) {
        await client.publicJoin(shortId, phone);
      },
      async unsubscribePhone() { /* implement later */ }
    }
  };
}

export function registerIpc(service: ServiceAPI) {
  ipcMain.handle('svc:auth:requestCode', (_e: any, p: any) => service.auth.requestVerificationCode(p));
  ipcMain.handle('svc:auth:verify', (_e: any, p: any) => service.auth.verifyCode(p));
  ipcMain.handle('svc:dev:get', () => service.developer.getDeveloper());
  ipcMain.handle('svc:dev:ensure', () => service.developer.ensureDeveloper());
  ipcMain.handle('svc:dev:setHubUrl', (_e: any, p: any) => service.developer.setHubUrl(p));
  ipcMain.handle('svc:channels:create', (_e: any, p: any) => service.channels.createChannel(p));
  ipcMain.handle('svc:channels:list', () => service.channels.listChannels());
  ipcMain.handle('svc:channels:publicList', (_e: any, p: any) => service.channels.publicList(p));
  ipcMain.handle('svc:channels:subscribePhone', (_e: any, p: any) => service.channels.subscribePhone(p));
}

