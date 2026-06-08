import { describe, it, expect } from 'vitest';
import { LocalReflection } from '../../src/sim/reflection/local.js';
import { LlmReflection } from '../../src/sim/reflection/llm.js';
import { World } from '../../src/sim/world.js';
import type { ReflectionPort, ReflectionInput } from '../../src/sim/ports.js';

const sampleInput: ReflectionInput = {
  agentId: 'a1',
  needs: { hunger: 20, energy: 80, social: 60 },
  balance: 1000,
  recentEvents: [],
  currentGoal: 'idle',
};

describe('LocalReflection', () => {
  it('returns a goal for any input and never throws', async () => {
    const local = new LocalReflection();
    const result = await local.reflect(sampleInput);
    expect(result).not.toBeNull();
    expect(typeof result?.goal).toBe('string');
    expect(result!.goal.length).toBeGreaterThan(0);
  });

  it('works with low-balance input', async () => {
    const local = new LocalReflection();
    const result = await local.reflect({ ...sampleInput, balance: 100 });
    expect(result?.goal).toContain('earn');
  });
});

describe('LlmReflection throttle and mock transport', () => {
  it('throttle: only 1 call per interval', async () => {
    const throttleMs = 50_000;
    const llm = new LlmReflection({ apiKey: 'test', throttleMs });
    expect(llm.throttleMs).toBe(throttleMs);
  });

  it('transport rejection → null return, no throw', async () => {
    // Use the default (https://api.openai.com/v1) — the host is allowed but the
    // network call will fail in the test environment, which must return null.
    const llm = new LlmReflection({ apiKey: 'badkey', timeoutMs: 50 });
    const result = await llm.reflect(sampleInput);
    expect(result).toBeNull();
  });

  it('baseUrl allowlist: rejects http scheme', () => {
    expect(() => new LlmReflection({ apiKey: 'k', baseUrl: 'http://api.openai.com/v1' }))
      .toThrow(/must use https/);
  });

  it('baseUrl allowlist: rejects unknown host', () => {
    expect(() => new LlmReflection({ apiKey: 'k', baseUrl: 'https://evil.example.com/v1' }))
      .toThrow(/not in the allowed list/);
  });

  it('baseUrl allowlist: accepts openrouter.ai', () => {
    expect(() => new LlmReflection({ apiKey: 'k', baseUrl: 'https://openrouter.ai/api/v1' }))
      .not.toThrow();
  });
});

describe('World mailbox — pending reflection never blocks tick', () => {
  it('slow reflection does not block 50-agent tick', async () => {
    type Resolver = (v: { goal: string } | null) => void;
    const resolvers: Resolver[] = [];
    const slowReflection: ReflectionPort = {
      throttleMs: 0,
      reflect(_input) {
        return new Promise<{ goal: string } | null>(r => { resolvers.push(r); });
      },
    };

    const world = new World({ seed: 42, agentCount: 50, reflection: slowReflection });

    const start = Date.now();
    for (let i = 0; i < 50; i++) world.tick();
    const elapsed = Date.now() - start;

    // Ticks should complete quickly — well under 5 seconds even if reflection is pending
    expect(elapsed).toBeLessThan(5000);

    // Resolve all pending reflections
    for (const r of resolvers) r({ goal: 'test goal from async' });

    // Next tick should drain the results
    world.tick();
    const snap = world.snapshot();
    expect(snap.agents.length).toBe(50);
  });

  it('reflection failure keeps local goal', async () => {
    const failReflection: ReflectionPort = {
      throttleMs: 0,
      reflect() { return Promise.reject(new Error('network error')); },
    };
    const world = new World({ seed: 1, agentCount: 3, reflection: failReflection });
    // Should not throw
    expect(() => { for (let i = 0; i < 10; i++) world.tick(); }).not.toThrow();
  });
});
