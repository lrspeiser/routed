import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

// Helper to require main.js fresh
function loadMainFresh() {
  const modPath = path.join(process.cwd(), 'main.js');
  // @ts-ignore
  delete require.cache[modPath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modPath);
}

describe('IPC: scripts:test and scripts:runNow argv + deno_missing', () => {
  const scriptsDir = path.join(process.cwd(), 'scripts');
  const id = 'sample-123';
  const dir = path.join(scriptsDir, id);

  beforeEach(() => {
    process.env.TEST_MODE = '1';
    fs.rmSync(scriptsDir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    // minimal manifest and script
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ id, mode: 'poller', defaultTopic: 'runs.finished', runtime: { port: null }, schedule: { type:'interval', everyMinutes: 5 } }, null, 2));
    fs.writeFileSync(path.join(dir, 'script.ts'), 'export async function handler(ctx){ await ctx.notify({ title: "ok", body: "ok" }); }');
  });

  it('returns deno_missing when no binary present', async () => {
const elec = require('electron');
    const ipc = elec.ipcMain?.handlers || elec.default?.ipcMain.handlers;
    const res = await ipc['scripts:test']({}, id);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('deno_missing');
  });

  it('constructs argv for oneshot poller run', async () => {
    // Fake a deno path by monkeypatching the orchestrator method via prototype hack
    const main = loadMainFresh();
    const orch = (main as any).scriptsOrch || undefined; // not exported; use handler to trigger
    // Instead, monkeypatch fs to pretend deno exists at resources/bin/deno-darwin-arm64
    const resBase = process.cwd();
    const binDir = path.join(resBase, 'resources', 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const denoPath = path.join(binDir, process.platform === 'darwin' ? 'deno-darwin-arm64' : 'deno-linux');
    fs.writeFileSync(denoPath, ''); // existence only

    // Mock child_process.spawn to capture argv
    const spawnModulePath = require.resolve('node:child_process');
    // @ts-ignore
    delete require.cache[spawnModulePath];
    vi.doMock('node:child_process', () => {
      return {
        spawn: (cmd: string, args: string[]) => {
          // Validate arguments
          expect(cmd).toContain('deno');
          expect(args).toContain('run');
          expect(args).toContain('--quiet');
          expect(args).toContain('--oneshot');
          const modeIdx = args.indexOf('--mode');
          expect(modeIdx).toBeGreaterThan(-1);
          expect(args[modeIdx + 1]).toBe('poller');
          // Fake process with immediate close(0)
          const { EventEmitter } = require('node:events');
          // @ts-ignore
          const proc = new EventEmitter();
          // fake stdout/stderr
          (proc as any).stdout = new EventEmitter();
          (proc as any).stderr = new EventEmitter();
          setTimeout(() => proc.emit('close', 0), 0);
          return proc;
        },
      };
    });

    // Re-require main.js so it picks the mocked child_process
    const modPath = path.join(process.cwd(), 'main.js');
    // @ts-ignore
    delete require.cache[modPath];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const reloaded = require(modPath);
const elec2 = require('electron');
    const ipc2 = elec2.ipcMain?.handlers || elec2.default?.ipcMain.handlers;
    const res = await ipc2['scripts:test']({}, id);
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
  });
});

