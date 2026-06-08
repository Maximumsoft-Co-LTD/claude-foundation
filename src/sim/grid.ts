export interface Tile {
  x: number;
  y: number;
  walkable: boolean;
}

export interface Pos {
  x: number;
  y: number;
}

export class Grid {
  private readonly _tiles: boolean[];
  private readonly _buckets: Map<number, Set<string>>;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this._tiles = new Array(width * height).fill(true);
    this._buckets = new Map();
  }

  private key(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isWalkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    return this._tiles[this.key(x, y)] ?? true;
  }

  setWalkable(x: number, y: number, walkable: boolean): void {
    if (this.inBounds(x, y)) {
      this._tiles[this.key(x, y)] = walkable;
    }
  }

  placeAgent(agentId: string, x: number, y: number): void {
    const k = this.key(x, y);
    let bucket = this._buckets.get(k);
    if (!bucket) {
      bucket = new Set();
      this._buckets.set(k, bucket);
    }
    bucket.add(agentId);
  }

  removeAgent(agentId: string, x: number, y: number): void {
    const bucket = this._buckets.get(this.key(x, y));
    if (bucket) bucket.delete(agentId);
  }

  agentsOnTile(x: number, y: number): ReadonlySet<string> {
    return this._buckets.get(this.key(x, y)) ?? new Set<string>();
  }

  findPath(from: Pos, to: Pos): Pos[] {
    if (from.x === to.x && from.y === to.y) return [from];
    if (!this.isWalkable(to.x, to.y)) {
      const near = this.nearestWalkable(to);
      if (!near) return [];
      return this.aStar(from, near);
    }
    return this.aStar(from, to);
  }

  nearestWalkable(pos: Pos): Pos | null {
    const dirs = [
      { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
      { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
      { dx: -1, dy: -1 }, { dx: 1, dy: -1 },
      { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
    ];
    const visited = new Set<number>();
    const queue: Pos[] = [pos];
    visited.add(this.key(pos.x, pos.y));

    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const { dx, dy } of dirs) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const k = this.key(nx, ny);
        if (visited.has(k)) continue;
        visited.add(k);
        if (this.isWalkable(nx, ny)) return { x: nx, y: ny };
        queue.push({ x: nx, y: ny });
      }
    }
    return null;
  }

  private aStar(from: Pos, to: Pos): Pos[] {
    const open = new MinHeap<ANode>();
    const gScore = new Map<number, number>();
    const parent = new Map<number, number>();

    const startKey = this.key(from.x, from.y);
    const goalKey = this.key(to.x, to.y);
    gScore.set(startKey, 0);
    open.push({ key: startKey, x: from.x, y: from.y, f: this.h(from, to) });

    const dirs4 = [
      { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
      { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
    ];

    while (!open.isEmpty()) {
      const cur = open.pop()!;
      if (cur.key === goalKey) {
        return this.reconstructPath(parent, cur.key);
      }
      const curG = gScore.get(cur.key) ?? Infinity;

      for (const { dx, dy } of dirs4) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!this.isWalkable(nx, ny)) continue;
        const nk = this.key(nx, ny);
        const ng = curG + 1;
        if (ng < (gScore.get(nk) ?? Infinity)) {
          gScore.set(nk, ng);
          parent.set(nk, cur.key);
          open.push({ key: nk, x: nx, y: ny, f: ng + this.h({ x: nx, y: ny }, to) });
        }
      }
    }
    return [];
  }

  private h(a: Pos, b: Pos): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  private reconstructPath(parent: Map<number, number>, endKey: number): Pos[] {
    const path: Pos[] = [];
    let k: number | undefined = endKey;
    while (k !== undefined) {
      const x = k % this.width;
      const y = Math.floor(k / this.width);
      path.unshift({ x, y });
      k = parent.get(k);
    }
    return path;
  }
}

interface ANode {
  key: number;
  x: number;
  y: number;
  f: number;
}

class MinHeap<T extends { f: number }> {
  private data: T[] = [];

  push(item: T): void {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): T | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0]!;
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  isEmpty(): boolean { return this.data.length === 0; }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.data[i]?.f ?? Infinity) < (this.data[parent]?.f ?? Infinity)) {
        const tmp = this.data[i]!;
        this.data[i] = this.data[parent]!;
        this.data[parent] = tmp;
        i = parent;
      } else break;
    }
  }

  private sinkDown(i: number): void {
    const n = this.data.length;
    while (true) {
      let min = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && (this.data[l]?.f ?? Infinity) < (this.data[min]?.f ?? Infinity)) min = l;
      if (r < n && (this.data[r]?.f ?? Infinity) < (this.data[min]?.f ?? Infinity)) min = r;
      if (min === i) break;
      const tmp = this.data[i]!;
      this.data[i] = this.data[min]!;
      this.data[min] = tmp;
      i = min;
    }
  }
}
