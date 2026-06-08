import { Application } from 'pixi.js';
import { World, type WorldOptions } from '../sim/world.js';
import { WorldView } from './worldView.js';
import { AgentSprites } from './agentSprites.js';
import { InspectPanel } from './inspectPanel.js';
import type { ReflectionPort } from '../sim/ports.js';
import { CONFIG } from '../sim/config.js';

export interface StartRenderOptions {
  seed?: number;
  agentCount?: number;
  reflection?: ReflectionPort | undefined;
}

export async function startRender(options: StartRenderOptions = {}): Promise<void> {
  const worldOpts: WorldOptions = {
    seed: options.seed ?? 42,
    agentCount: options.agentCount ?? CONFIG.agentCount,
  };
  if (options.reflection !== undefined) worldOpts.reflection = options.reflection;
  const world = new World(worldOpts);

  const app = new Application();
  await app.init({
    width: CONFIG.gridWidth * CONFIG.tileSize,
    height: CONFIG.gridHeight * CONFIG.tileSize,
    backgroundColor: 0x0f172a,
    antialias: false,
  });

  document.body.appendChild(app.canvas as HTMLCanvasElement);

  const worldView = new WorldView(app);
  const agentSprites = new AgentSprites(app);

  let snapshot = world.snapshot();
  worldView.drawLandmarks(snapshot);

  const panel = new InspectPanel({
    getEvents: (id) => world.recentEvents(id, 10),
    getRelationships: (id) => world.getRelationships(id),
  });

  agentSprites.onAgentClick((id) => panel.open(id));

  let lastTickMs = 0;
  const tickIntervalMs = CONFIG.tickIntervalMs;

  app.ticker.add(({ deltaMS }) => {
    lastTickMs += deltaMS;
    while (lastTickMs >= tickIntervalMs) {
      snapshot = world.tick();
      lastTickMs -= tickIntervalMs;
    }
    worldView.update(snapshot);
    agentSprites.update(snapshot);
    panel.onSnapshot(snapshot);
  });
}
