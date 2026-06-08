import type { LandmarkView } from './landmarks.js';

export interface NeedsVector {
  hunger: number;
  energy: number;
  social: number;
}

export interface AgentView {
  id: string;
  pos: { x: number; y: number };
  needs: NeedsVector;
  balance: number;
  goal: string;
  professionId: string;
  thought: string;
}

export interface WorldSnapshot {
  readonly tick: number;
  readonly phase: 'day' | 'night';
  readonly agents: ReadonlyArray<AgentView>;
  readonly landmarks: ReadonlyArray<LandmarkView>;
}

export interface SimEvent {
  tick: number;
  agentId: string;
  kind: string;
  detail: string;
}

export interface ReflectionInput {
  agentId: string;
  needs: NeedsVector;
  balance: number;
  recentEvents: ReadonlyArray<SimEvent>;
  currentGoal: string;
}

export interface ReflectionPort {
  reflect(input: ReflectionInput): Promise<{ goal: string } | null>;
  readonly throttleMs: number;
}
