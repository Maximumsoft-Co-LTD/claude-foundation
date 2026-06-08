import { CONFIG } from './config.js';

export interface RelationshipEdge {
  agentIdA: string;
  agentIdB: string;
  strength: number;
  coPresenceTicks: number;
}

export class RelationshipGraph {
  private readonly _edges: Map<string, RelationshipEdge> = new Map();
  private readonly _agentEdges: Map<string, Set<string>> = new Map();

  private edgeKey(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`;
  }

  getEdge(a: string, b: string): RelationshipEdge | undefined {
    return this._edges.get(this.edgeKey(a, b));
  }

  getEdgesFor(agentId: string): RelationshipEdge[] {
    const keys = this._agentEdges.get(agentId);
    if (!keys) return [];
    return [...keys].map(k => this._edges.get(k)).filter((e): e is RelationshipEdge => !!e);
  }

  recordCoPresence(agentIdA: string, agentIdB: string): void {
    const key = this.edgeKey(agentIdA, agentIdB);
    let edge = this._edges.get(key);

    if (!edge) {
      const edgesA = this._agentEdges.get(agentIdA)?.size ?? 0;
      const edgesB = this._agentEdges.get(agentIdB)?.size ?? 0;

      if (edgesA >= CONFIG.relationshipMaxPerAgent || edgesB >= CONFIG.relationshipMaxPerAgent) {
        if (!this.canAddEdge(agentIdA) || !this.canAddEdge(agentIdB)) return;
      }

      edge = { agentIdA, agentIdB, strength: 0, coPresenceTicks: 0 };
      this._edges.set(key, edge);
      this.addToIndex(agentIdA, key);
      this.addToIndex(agentIdB, key);
    }

    edge.coPresenceTicks++;
    if (edge.coPresenceTicks >= CONFIG.relationshipCoPresenceTicks) {
      edge.strength = Math.min(1, edge.strength + CONFIG.relationshipStrengthGain);
    }
  }

  private canAddEdge(agentId: string): boolean {
    const edges = this.getEdgesFor(agentId);
    if (edges.length < CONFIG.relationshipMaxPerAgent) return true;
    return edges.some(e => e.strength < CONFIG.relationshipDecayThreshold);
  }

  private evictWeakEdge(agentId: string): void {
    const edges = this.getEdgesFor(agentId);
    const weak = edges
      .filter(e => e.strength < CONFIG.relationshipDecayThreshold)
      .sort((a, b) => a.strength - b.strength)[0];
    if (weak) {
      const key = this.edgeKey(weak.agentIdA, weak.agentIdB);
      this._edges.delete(key);
      this._agentEdges.get(weak.agentIdA)?.delete(key);
      this._agentEdges.get(weak.agentIdB)?.delete(key);
    }
  }

  private addToIndex(agentId: string, key: string): void {
    let set = this._agentEdges.get(agentId);
    if (!set) {
      set = new Set();
      this._agentEdges.set(agentId, set);
    }
    if (set.size >= CONFIG.relationshipMaxPerAgent) {
      this.evictWeakEdge(agentId);
    }
    set.add(key);
  }

  decayAll(): void {
    for (const [key, edge] of this._edges) {
      edge.strength = Math.max(0, edge.strength - CONFIG.relationshipDecayPerTick);
      if (edge.strength === 0) {
        this._edges.delete(key);
        this._agentEdges.get(edge.agentIdA)?.delete(key);
        this._agentEdges.get(edge.agentIdB)?.delete(key);
      }
    }
  }

  socialMultiplier(agentIdA: string, agentIdB: string): number {
    const edge = this.getEdge(agentIdA, agentIdB);
    if (!edge) return 1;
    return 1 + edge.strength * CONFIG.socialBonusFactor;
  }
}
