import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// We will require the module fresh per test via delete cache to re-run assembly logic
function freshMain() {
  const modPath = path.join(process.cwd(), 'main.js');
  // delete from require cache
  // @ts-ignore
  delete require.cache[modPath];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(modPath);
}

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

describe('scripts:ai:generate prompt assembly', () => {
  const resDir = path.join(process.cwd(), 'resources', 'ai');

  beforeEach(() => {
    process.env.TEST_MODE = '1';
    // Ensure guides exist for deterministic test
    writeFile(path.join(resDir, 'prompt_guides.md'), '# TEST-GUIDE\nRuleA');
    writeFile(path.join(resDir, 'dev_api_guide.md'), '# TEST-DEV-GUIDE\nAuth header');
  });

  it('includes guardrails and Routed API guide markers in user content', async () => {
    const { ipcMain } = freshMain().__proto__ ? require('electron') : require('electron');
    // monkeypatch environment for missing key handling bypass
    process.env.OPENAI_API_KEY = 'test-key';

    // Mock fetch to OpenAI to capture body
    const originalFetch = global.fetch;
    const fetchSpy = vi.fn(async (url: string, init: any) => {
      const payload = JSON.parse(init.body);
      const userMsg = payload.messages.find((m: any) => m.role === 'user')?.content as string;
      expect(userMsg).toContain('# TEST-GUIDE');
      expect(userMsg).toContain('<<<ROUTED_API_GUIDE_START>>>');
      expect(userMsg).toContain('# TEST-DEV-GUIDE');
      expect(userMsg).toContain('<<<ROUTED_API_GUIDE_END>>>');
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '```ts\nexport const ok = true\n```' } }] })
      } as any;
    });
    // @ts-ignore
    global.fetch = fetchSpy;

const elec = require('electron');
    const result = await (elec.ipcMain?.handlers || elec.default?.ipcMain.handlers)['scripts:ai:generate']({}, {
      mode: 'poller',
      prompt: 'Use Open-Meteo at https://api.open-meteo.com/v1/forecast?latitude=37.7749&longitude=-122.4194&hourly=temperature_2m',
      currentCode: '',
      topic: 'runs.finished',
      contextData: ''
    });

    expect(result.ok).toBe(true);
    expect(result.code).toContain('export const ok = true');

    // restore fetch
    // @ts-ignore
    global.fetch = originalFetch;
  });

  it('returns error when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;
const elec2 = require('electron');
    const res = await (elec2.ipcMain?.handlers || elec2.default?.ipcMain.handlers)['scripts:ai:generate']({}, { mode: 'poller', prompt: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('missing_openai_key');
  });
});

