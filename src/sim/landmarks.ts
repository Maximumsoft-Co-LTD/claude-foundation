import type { Pos } from './grid.js';
import type { Rng } from './rng.js';

export type LandmarkType = 'market' | 'temple' | 'office' | 'condo' | 'park' | 'bts';

export interface Landmark {
  id: string;
  type: LandmarkType;
  pos: Pos;
  name: string;
}

export interface LandmarkView {
  id: string;
  type: LandmarkType;
  pos: Pos;
  name: string;
}

const LANDMARK_NAMES: Record<LandmarkType, string[]> = {
  market: ['Chatuchak Market', 'Or Tor Kor Market', 'Talad Neon'],
  temple: ['Wat Phra Kaew', 'Wat Arun', 'Wat Pho'],
  office: ['Silom Tower', 'Sathorn Unique', 'Asoke Plaza'],
  condo: ['Sukhumvit Condo', 'Ratchada Residence', 'Ladprao Flats'],
  park: ['Lumpini Park', 'Benchakitti Park', 'Chatuchak Park'],
  bts: ['BTS Asok', 'BTS Siam', 'BTS On Nut'],
};

const REQUIRED_TYPES: LandmarkType[] = ['market', 'temple', 'office', 'condo', 'park', 'bts'];

export interface LandmarkSet {
  landmarks: Landmark[];
  warnings: string[];
}

export function placeLandmarks(
  gridWidth: number,
  gridHeight: number,
  rng: Rng,
): LandmarkSet {
  const landmarks: Landmark[] = [];
  const warnings: string[] = [];
  const usedTiles = new Set<string>();

  function tileKey(x: number, y: number): string { return `${x},${y}`; }

  function pickTile(): Pos | null {
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = rng.nextInt(1, gridWidth - 2);
      const y = rng.nextInt(1, gridHeight - 2);
      if (!usedTiles.has(tileKey(x, y))) {
        usedTiles.add(tileKey(x, y));
        return { x, y };
      }
    }
    return null;
  }

  let idx = 0;
  for (const type of REQUIRED_TYPES) {
    const names = LANDMARK_NAMES[type];
    const name = names[idx % names.length] ?? type;
    const pos = pickTile();
    if (!pos) {
      warnings.push(`Could not place landmark type=${type}: grid full`);
      continue;
    }
    landmarks.push({ id: `lm_${type}_0`, type, pos, name });
    idx++;
  }

  // Extra variety: add more of each type
  for (const type of REQUIRED_TYPES) {
    const extraCount = rng.nextInt(1, 2);
    const names = LANDMARK_NAMES[type];
    for (let i = 1; i <= extraCount; i++) {
      const pos = pickTile();
      if (!pos) continue;
      const name = names[i % names.length] ?? type;
      landmarks.push({ id: `lm_${type}_${i}`, type, pos, name });
    }
  }

  return { landmarks, warnings };
}

export function getLandmarksByType(landmarks: Landmark[], type: LandmarkType): Landmark[] {
  return landmarks.filter(l => l.type === type);
}

export function getSpawnTiles(
  landmarks: Landmark[],
  gridWidth: number,
  gridHeight: number,
  rng: Rng,
  count: number,
): { tiles: Pos[]; warnings: string[] } {
  const usedKeys = new Set(landmarks.map(l => `${l.pos.x},${l.pos.y}`));
  const tiles: Pos[] = [];
  const warnings: string[] = [];

  for (let attempt = 0; attempt < count * 20 && tiles.length < count; attempt++) {
    const x = rng.nextInt(0, gridWidth - 1);
    const y = rng.nextInt(0, gridHeight - 1);
    const k = `${x},${y}`;
    if (!usedKeys.has(k)) {
      usedKeys.add(k);
      tiles.push({ x, y });
    }
  }

  if (tiles.length < count) {
    warnings.push(`Only placed ${tiles.length}/${count} agents — grid too small`);
  }
  return { tiles, warnings };
}
