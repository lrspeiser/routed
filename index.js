"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRuntimeService = createRuntimeService;
exports.registerIpc = registerIpc;
// Use runtime relative require so the packaged app can resolve inside app.asar
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HubHttpClient } = require('../adapters/hub-http/dist/index.js');
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function userDataPath(...segs) {
    try {
        return path.join(electron_1.app.getPath('userData'), ...segs);
    }
    catch {
        return path.join(process.cwd(), ...segs);
    }
}
function readJson(file) { try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}
catch {
    return null;
} }
function writeJson(file, data) { try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
catch { } }
function createRuntimeService(baseUrl) {
    const client = new HubHttpClient({ baseUrl });
    const sessionFile = userDataPath('session.json');
    const devFile = userDataPath('dev.json');
    async function getSession() {
        const s = readJson(sessionFile) || {};
        if (!s.user)
            return { state: 'unauthenticated' };
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
                if (!ok)
                    throw new Error('hub_unreachable');
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
                const res = await authedClient.channelsList();
                const channels = (res && Array.isArray(res.channels)) ? res.channels : (Array.isArray(res) ? res : []);
                return { channels };
            },
            async publicList({ phone }) {
                const res = await client.publicChannelsList(phone);
                const channels = (res && Array.isArray(res.channels)) ? res.channels : (Array.isArray(res) ? res : []);
                return { channels };
            },
            async subscribePhone({ shortId, phone }) {
                await client.publicJoin(shortId, phone);
            },
            async unsubscribePhone() { }
        }
    };
}
function registerIpc(service) {
    electron_1.ipcMain.handle('svc:auth:requestCode', (_e, p) => service.auth.requestVerificationCode(p));
    electron_1.ipcMain.handle('svc:auth:verify', (_e, p) => service.auth.verifyCode(p));
    electron_1.ipcMain.handle('svc:dev:get', () => service.developer.getDeveloper());
    electron_1.ipcMain.handle('svc:dev:ensure', () => service.developer.ensureDeveloper());
    electron_1.ipcMain.handle('svc:dev:setHubUrl', (_e, p) => service.developer.setHubUrl(p));
    electron_1.ipcMain.handle('svc:channels:create', (_e, p) => service.channels.createChannel(p));
    electron_1.ipcMain.handle('svc:channels:list', () => service.channels.listChannels());
    electron_1.ipcMain.handle('svc:channels:publicList', (_e, p) => service.channels.publicList(p));
    electron_1.ipcMain.handle('svc:channels:subscribePhone', (_e, p) => service.channels.subscribePhone(p));
}
