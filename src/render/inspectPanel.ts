import type { WorldSnapshot, SimEvent } from '../sim/ports.js';
import type { RelationshipEdge } from '../sim/relationships.js';

export interface InspectPanelDeps {
  getEvents(agentId: string): SimEvent[];
  getRelationships(agentId: string): RelationshipEdge[];
}

export class InspectPanel {
  private _inspectedId: string | null = null;
  private readonly _el: HTMLElement;
  private readonly _deps: InspectPanelDeps;

  constructor(deps: InspectPanelDeps) {
    this._deps = deps;
    this._el = this.createDOM();
    document.body.appendChild(this._el);
  }

  open(agentId: string): void {
    this._inspectedId = agentId;
    this._el.style.display = 'block';
  }

  close(): void {
    this._inspectedId = null;
    this._el.style.display = 'none';
  }

  onSnapshot(snapshot: WorldSnapshot): void {
    if (!this._inspectedId) return;
    const agent = snapshot.agents.find(a => a.id === this._inspectedId);
    if (!agent) {
      this.showInactive();
      return;
    }
    this.render(agent.id, agent.needs.hunger, agent.needs.energy, agent.needs.social,
      agent.balance, agent.goal, agent.thought,
      this._deps.getEvents(agent.id),
      this._deps.getRelationships(agent.id));
  }

  private showInactive(): void {
    const content = this._el.querySelector('.inspect-content');
    if (content) content.innerHTML = '<p style="color:#f87171">Agent no longer active.</p>';
  }

  private render(
    id: string,
    hunger: number,
    energy: number,
    social: number,
    balance: number,
    goal: string,
    thought: string,
    events: SimEvent[],
    rels: RelationshipEdge[],
  ): void {
    const content = this._el.querySelector('.inspect-content');
    if (!content) return;

    const bar = (label: string, val: number, color: string) =>
      `<div style="margin:2px 0">
        <span style="display:inline-block;width:60px;font-size:11px">${label}</span>
        <span style="display:inline-block;background:#334155;width:120px;height:10px;vertical-align:middle;border-radius:4px">
          <span style="display:block;background:${color};width:${val.toFixed(0)}%;height:100%;border-radius:4px"></span>
        </span>
        <span style="font-size:10px;margin-left:4px">${val.toFixed(0)}%</span>
      </div>`;

    const evHtml = events.slice(-10).reverse().map(e =>
      `<div style="font-size:10px;color:#94a3b8">[${e.tick}] ${e.kind}: ${e.detail}</div>`
    ).join('');

    const relHtml = rels.slice(0, 5).map(r => {
      const other = r.agentIdA === id ? r.agentIdB : r.agentIdA;
      return `<div style="font-size:10px;color:#a5f3fc">${other}: ${(r.strength * 100).toFixed(0)}%</div>`;
    }).join('') || '<div style="font-size:10px;color:#64748b">None yet</div>';

    content.innerHTML = `
      <div style="font-size:12px;color:#94a3b8;margin-bottom:4px">Agent: ${id}</div>
      <div style="margin-bottom:6px">
        ${bar('Hunger', hunger, '#f59e0b')}
        ${bar('Energy', energy, '#22c55e')}
        ${bar('Social', social, '#a78bfa')}
      </div>
      <div style="font-size:11px;color:#fbbf24;margin-bottom:4px">Goal: ${goal}</div>
      <div style="font-size:10px;color:#e2e8f0;background:#1e293b;padding:4px;border-radius:4px;margin-bottom:6px">
        💭 ${thought || '…'}
      </div>
      <div style="font-size:11px;color:#64748b;margin-bottom:2px">Balance: ${balance} ¢</div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:2px">Activity log:</div>
      <div style="max-height:80px;overflow-y:auto;background:#0f172a;padding:4px;border-radius:4px;margin-bottom:6px">
        ${evHtml || '<div style="font-size:10px;color:#64748b">No events yet</div>'}
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:2px">Relationships:</div>
      <div>${relHtml}</div>
    `;
  }

  private createDOM(): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed; top:10px; right:10px; width:240px;
      background:#1e293b; color:#e2e8f0; border-radius:8px;
      padding:12px; font-family:monospace; z-index:100;
      box-shadow:0 4px 24px rgba(0,0,0,0.5); display:none;
    `;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'float:right;background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px';
    closeBtn.onclick = () => this.close();
    el.appendChild(closeBtn);

    const title = document.createElement('div');
    title.style.cssText = 'font-size:13px;font-weight:bold;color:#e2e8f0;margin-bottom:8px';
    title.textContent = 'Agent Inspector';
    el.appendChild(title);

    const content = document.createElement('div');
    content.className = 'inspect-content';
    el.appendChild(content);
    return el;
  }
}
