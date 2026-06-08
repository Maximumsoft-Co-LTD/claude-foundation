import type { LandmarkType } from '../landmarks.js';
import type { NeedsVector } from '../ports.js';

export interface ActionEffects {
  hunger?: number;
  energy?: number;
  social?: number;
  balanceDelta?: number;
}

export interface ActionDef {
  id: string;
  label: string;
  requiresLandmark: LandmarkType | undefined;
  cost: number;
  isFree: boolean;
  precondition(balance: number, needs: NeedsVector): boolean;
  effects: ActionEffects;
  baseScore(needs: NeedsVector, balance: number): number;
}

export const ACTIONS: ActionDef[] = [
  {
    id: 'buy_food',
    label: 'Buy food at market',
    requiresLandmark: 'market',
    cost: 200,
    isFree: false,
    precondition(balance, needs) {
      return balance >= 200 && needs.hunger < 70;
    },
    effects: { hunger: 40, balanceDelta: -200 },
    baseScore(needs) {
      const urgency = Math.max(0, 100 - needs.hunger);
      return urgency * 0.8;
    },
  },
  {
    id: 'work',
    label: 'Work at job landmark',
    requiresLandmark: undefined,
    cost: 0,
    isFree: true,
    precondition(_balance, needs) {
      return needs.energy > 20;
    },
    effects: { energy: -10, balanceDelta: 0 },
    baseScore(needs, balance) {
      const moneyUrgency = Math.max(0, 5000 - balance) / 100;
      const energyOk = needs.energy > 30 ? 1 : 0.3;
      return moneyUrgency * energyOk * 0.5;
    },
  },
  {
    id: 'rest',
    label: 'Rest at park',
    requiresLandmark: 'park',
    cost: 0,
    isFree: true,
    precondition(_balance, needs) {
      return needs.energy < 80;
    },
    effects: { energy: 25 },
    baseScore(needs) {
      return Math.max(0, 80 - needs.energy) * 0.5;
    },
  },
  {
    id: 'sleep',
    label: 'Sleep at condo',
    requiresLandmark: 'condo',
    cost: 0,
    isFree: true,
    precondition(_balance, needs) {
      return needs.energy < 50;
    },
    effects: { energy: 50 },
    baseScore(needs) {
      return Math.max(0, 80 - needs.energy) * 0.9;
    },
  },
  {
    id: 'socialise',
    label: 'Socialise at park',
    requiresLandmark: 'park',
    cost: 0,
    isFree: true,
    precondition(_balance, needs) {
      return needs.social < 80;
    },
    effects: { social: 20 },
    baseScore(needs) {
      return Math.max(0, 80 - needs.social) * 0.4;
    },
  },
  {
    id: 'idle',
    label: 'Idle at park',
    requiresLandmark: 'park',
    cost: 0,
    isFree: true,
    precondition() {
      return true;
    },
    effects: { energy: 5 },
    baseScore() {
      return 1;
    },
  },
];

export function getAction(id: string): ActionDef | undefined {
  return ACTIONS.find(a => a.id === id);
}
