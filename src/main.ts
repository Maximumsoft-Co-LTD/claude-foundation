import { startRender } from './render/app.js';
import { LlmReflection } from './sim/reflection/llm.js';

// import.meta.env is injected by Vite at build time
const apiKey: string = (import.meta as { env?: { VITE_OPENAI_API_KEY?: string } })
  .env?.['VITE_OPENAI_API_KEY'] ?? '';

startRender({
  seed: 42,
  ...(apiKey ? { reflection: new LlmReflection({ apiKey }) } : {}),
}).catch(console.error);
