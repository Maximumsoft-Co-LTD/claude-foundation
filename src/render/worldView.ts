import { Application, Graphics, Container, Text, TextStyle } from 'pixi.js';
import type { WorldSnapshot } from '../sim/ports.js';
import type { LandmarkType } from '../sim/landmarks.js';
import { CONFIG } from '../sim/config.js';

const LANDMARK_COLORS: Record<LandmarkType, number> = {
  market: 0xf59e0b,
  temple: 0x8b5cf6,
  office: 0x3b82f6,
  condo: 0x10b981,
  park: 0x22c55e,
  bts: 0xef4444,
};

const DAY_TINT = 0xffffff;
const NIGHT_TINT = 0x334466;

export class WorldView {
  private readonly _container: Container;
  private _currentPhase: 'day' | 'night' = 'day';
  private readonly _background: Graphics;
  private readonly _tileSize: number;

  constructor(app: Application) {
    this._tileSize = CONFIG.tileSize;
    this._container = new Container();
    app.stage.addChild(this._container);

    this._background = new Graphics();
    this._container.addChild(this._background);

    this.drawGrid(app);
  }

  private drawGrid(app: Application): void {
    const g = new Graphics();
    g.setStrokeStyle({ width: 1, color: 0x1e293b, alpha: 0.3 });
    for (let x = 0; x <= CONFIG.gridWidth; x++) {
      g.moveTo(x * this._tileSize, 0);
      g.lineTo(x * this._tileSize, CONFIG.gridHeight * this._tileSize);
    }
    for (let y = 0; y <= CONFIG.gridHeight; y++) {
      g.moveTo(0, y * this._tileSize);
      g.lineTo(CONFIG.gridWidth * this._tileSize, y * this._tileSize);
    }
    g.stroke();
    this._container.addChild(g);
    void app;
  }

  update(snapshot: WorldSnapshot): void {
    if (snapshot.phase !== this._currentPhase) {
      this._currentPhase = snapshot.phase;
      this._background.clear();
      const tint = snapshot.phase === 'night' ? 0x0a0f1e : 0x1e3a5f;
      this._background.rect(0, 0, CONFIG.gridWidth * this._tileSize, CONFIG.gridHeight * this._tileSize);
      this._background.fill({ color: tint, alpha: 0.4 });
    }

    this._container.tint = snapshot.phase === 'night' ? NIGHT_TINT : DAY_TINT;
  }

  drawLandmarks(snapshot: WorldSnapshot): void {
    for (const lm of snapshot.landmarks) {
      const g = new Graphics();
      const color = LANDMARK_COLORS[lm.type] ?? 0xffffff;
      g.roundRect(
        lm.pos.x * this._tileSize + 2,
        lm.pos.y * this._tileSize + 2,
        this._tileSize - 4,
        this._tileSize - 4,
        4,
      );
      g.fill({ color, alpha: 0.85 });

      const style = new TextStyle({ fontSize: 8, fill: 0xffffff });
      const label = new Text({ text: lm.type[0]?.toUpperCase() ?? '?', style });
      label.x = lm.pos.x * this._tileSize + 4;
      label.y = lm.pos.y * this._tileSize + 4;
      this._container.addChild(g);
      this._container.addChild(label);
    }
  }

  get container(): Container { return this._container; }
}
