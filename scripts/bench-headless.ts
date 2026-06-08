import { World } from '../src/sim/world.js';
import { LocalReflection } from '../src/sim/reflection/local.js';

function parseArgs(): { agents: number; ticks: number } {
  const args = process.argv.slice(2);
  let agents = 50;
  let ticks = 1000;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agents' && args[i + 1]) {
      agents = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === '--ticks' && args[i + 1]) {
      ticks = parseInt(args[i + 1]!, 10);
      i++;
    }
  }
  return { agents, ticks };
}

const { agents, ticks } = parseArgs();

const world = new World({
  seed: 42,
  agentCount: agents,
  reflection: new LocalReflection(),
});

const start = Date.now();
for (let i = 0; i < ticks; i++) {
  world.tick();
}
const elapsed = Date.now() - start;

const snapshot = world.snapshot();
console.log(`bench: agents=${agents} ticks=${ticks} wall-clock=${elapsed}ms (${(elapsed / 1000).toFixed(2)}s)`);
console.log(`final tick=${snapshot.tick} phase=${snapshot.phase} agents=${snapshot.agents.length}`);

if (elapsed > 10_000) {
  console.error(`FAIL: ${elapsed}ms > 10000ms budget`);
  process.exit(1);
}
