import type { ReflectionPort, ReflectionInput } from '../ports.js';
import { CONFIG } from '../config.js';

// Hosts that may receive the Authorization bearer token. Extend this list (or
// point at a same-origin proxy) rather than removing the check.
const ALLOWED_HOSTS = new Set([
  'api.openai.com',
  'openrouter.ai',
]);

function assertSafeBaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`LlmReflection: baseUrl is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`LlmReflection: baseUrl must use https (got ${parsed.protocol})`);
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `LlmReflection: baseUrl hostname "${parsed.hostname}" is not in the allowed list. ` +
      `Add it to ALLOWED_HOSTS in llm.ts or route through a same-origin proxy.`,
    );
  }
}

export interface LlmReflectionOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  throttleMs?: number;
  timeoutMs?: number;
}

export class LlmReflection implements ReflectionPort {
  readonly throttleMs: number;
  private readonly _apiKey: string;
  private readonly _baseUrl: string;
  private readonly _model: string;
  private readonly _timeoutMs: number;

  constructor(options: LlmReflectionOptions) {
    this._apiKey = options.apiKey;
    this._baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    assertSafeBaseUrl(this._baseUrl);
    this._model = options.model ?? 'gpt-4o-mini';
    this.throttleMs = options.throttleMs ?? CONFIG.reflectionDefaultThrottleMs;
    this._timeoutMs = options.timeoutMs ?? 10_000;
  }

  async reflect(input: ReflectionInput): Promise<{ goal: string } | null> {
    const prompt = this.buildPrompt(input);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this._timeoutMs);

      const res = await fetch(`${this._baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._apiKey}`,
        },
        body: JSON.stringify({
          model: this._model,
          max_tokens: 60,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      if (!res.ok) return null;

      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) return null;
      return { goal: text.slice(0, 120) };
    } catch {
      return null;
    }
  }

  private buildPrompt(input: ReflectionInput): string {
    const n = input.needs;
    const recentSummary = input.recentEvents
      .slice(-5)
      .map(e => `${e.kind}: ${e.detail}`)
      .join('; ');
    return (
      `You are an AI agent in a Bangkok city simulation. ` +
      `Current state — hunger:${n.hunger.toFixed(0)}, energy:${n.energy.toFixed(0)}, ` +
      `social:${n.social.toFixed(0)}, balance:${input.balance} cents. ` +
      `Recent: ${recentSummary || 'none'}. Current goal: "${input.currentGoal}". ` +
      `Reply with ONE short goal sentence (≤15 words), nothing else.`
    );
  }
}
