import { CONFIG } from './config.js';
import type { NeedsVector } from './ports.js';

export function decayNeeds(needs: NeedsVector): void {
  needs.hunger = Math.max(
    CONFIG.needsMin,
    needs.hunger - CONFIG.needsDecayPerTick.hunger,
  );
  needs.energy = Math.max(
    CONFIG.needsMin,
    needs.energy - CONFIG.needsDecayPerTick.energy,
  );
  needs.social = Math.max(
    CONFIG.needsMin,
    needs.social - CONFIG.needsDecayPerTick.social,
  );
}

export function satisfyNeed(
  needs: NeedsVector,
  field: keyof NeedsVector,
  amount: number,
): void {
  needs[field] = Math.min(CONFIG.needsMax, needs[field] + amount);
}

export function clampNeeds(needs: NeedsVector): void {
  needs.hunger = Math.max(CONFIG.needsMin, Math.min(CONFIG.needsMax, needs.hunger));
  needs.energy = Math.max(CONFIG.needsMin, Math.min(CONFIG.needsMax, needs.energy));
  needs.social = Math.max(CONFIG.needsMin, Math.min(CONFIG.needsMax, needs.social));
}

export function needsUrgency(needs: NeedsVector): string {
  const entries: [string, number][] = [
    ['hunger', needs.hunger],
    ['energy', needs.energy],
    ['social', needs.social],
  ];
  entries.sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0));
  return entries[0]?.[0] ?? 'hunger';
}
