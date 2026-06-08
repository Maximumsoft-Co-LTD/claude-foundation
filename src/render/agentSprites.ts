import { Application, Graphics, Container } from 'pixi.js';
import type { WorldSnapshot, AgentView } from '../sim/ports.js';
import { CONFIG } from '../sim/config.js';

const PROFESSION_COLORS: Record<string, number> = {
  market_vendor: 0xf59e0b,
  office_worker: 0x3b82f6,
  temple_volunteer: 0x8b5cf6,
};

const HIT_RADIUS = CONFIG.tileSize * 0.4;

export class AgentSprites {
  private readonly _container: Container;
  private readonly _sprites: Map<string, Graphics> = new Map();
  private readonly _tileSize: number;

  constructor(app: Application) {
    this._tileSize = CONFIG.tileSize;
    this._container = new Container();
    app.stage.addChild(this._container);
  }

  onAgentClick(handler: (agentId: string) => void): void {
    this._container.eventMode = 'static';
    this._container.on('pointerdown', (e) => {
      const gx = e.global.x;
      const gy = e.global.y;
      for (const [id, sprite] of this._sprites) {
        const dx = sprite.x - gx;
        const dy = sprite.y - gy;
        if (dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS) {
          handler(id);
          return;
        }
      }
    });
  }

  update(snapshot: WorldSnapshot): void {
    const seen = new Set<string>();

    for (const agent of snapshot.agents) {
      seen.add(agent.id);
      let sprite = this._sprites.get(agent.id);
      if (!sprite) {
        sprite = this.createSprite(agent);
        this._sprites.set(agent.id, sprite);
        this._container.addChild(sprite);
      }
      this.updateSprite(sprite, agent);
    }

    for (const [id, sprite] of this._sprites) {
      if (!seen.has(id)) {
        this._container.removeChild(sprite);
        sprite.destroy();
        this._sprites.delete(id);
      }
    }
  }

  private createSprite(agent: AgentView): Graphics {
    const g = new Graphics();
    g.eventMode = 'static';
    g.cursor = 'pointer';
    const color = PROFESSION_COLORS[agent.professionId] ?? 0xffffff;
    const half = this._tileSize / 2;
    g.circle(0, 0, half * 0.4);
    g.fill({ color, alpha: 0.9 });
    return g;
  }

  private updateSprite(sprite: Graphics, agent: AgentView): void {
    sprite.x = agent.pos.x * this._tileSize + this._tileSize / 2;
    sprite.y = agent.pos.y * this._tileSize + this._tileSize / 2;

    const energyRatio = agent.needs.energy / 100;
    sprite.alpha = 0.5 + energyRatio * 0.5;
  }

  get container(): Container { return this._container; }
  get spriteCount(): number { return this._sprites.size; }
}
