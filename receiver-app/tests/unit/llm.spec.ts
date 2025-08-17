import { describe, it, expect } from 'vitest';
import { extractCodeFromLLM } from '../../utils/llm.js';

describe('utils/llm.extractCodeFromLLM', () => {
  it('returns fenced code block content when present', () => {
    const input = 'text before```ts\nconst a = 1\n```text after';
    expect(extractCodeFromLLM(input).trim()).toBe('const a = 1');
  });

  it('falls back to raw content when no fence', () => {
    const input = 'no code fences here';
    expect(extractCodeFromLLM(input)).toBe(input);
  });

  it('handles different language tags', () => {
    const input = '```python\nprint(123)\n```';
    expect(extractCodeFromLLM(input).trim()).toBe('print(123)');
  });
});

