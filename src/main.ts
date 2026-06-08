import { startRender } from './render/app.js';
import { LlmReflection } from './sim/reflection/llm.js';

// SECURITY: VITE_* env vars are inlined into the client bundle by Vite at build
// time, so any key set here is readable by anyone who opens the page.
// LlmReflection is therefore only enabled in the local dev server (DEV=true).
// For a public deployment, proxy the LLM call server-side and use LocalReflection
// (the default, no-key binding) as the only safe client path.
const env = (import.meta as { env?: { DEV?: boolean; VITE_OPENAI_API_KEY?: string } }).env;
const apiKey: string = (env?.DEV ? env?.['VITE_OPENAI_API_KEY'] : undefined) ?? '';

startRender({
  seed: 42,
  ...(apiKey ? { reflection: new LlmReflection({ apiKey }) } : {}),
}).catch(console.error);
