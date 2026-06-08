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
    if (!content) return;
    content.textContent = '';
    const p = document.createElement('p');
    p.style.color = '#f87171';
    p.textContent = 'Agent no longer active.';
    content.appendChild(p);
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
    content.textContent = '';

    // Agent id row — id comes from the sim's own key space (no LLM taint), but
    // still use textContent so the pattern is uniform.
    const idRow = document.createElement('div');
    idRow.style.cssText = 'font-size:12px;color:#94a3b8;margin-bottom:4px';
    idRow.textContent = `Agent: ${id}`;
    content.appendChild(idRow);

    // Need bars (all values are numbers, no LLM taint)
    const barsDiv = document.createElement('div');
    barsDiv.style.marginBottom = '6px';
    const addBar = (label: string, val: number, color: string) => {
      const row = document.createElement('div');
      row.style.cssText = 'margin:2px 0';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'display:inline-block;width:60px;font-size:11px';
      lbl.textContent = label;
      const track = document.createElement('span');
      track.style.cssText = 'display:inline-block;background:#334155;width:120px;height:10px;vertical-align:middle;border-radius:4px';
      const fill = document.createElement('span');
      fill.style.cssText = `display:block;background:${color};width:${val.toFixed(0)}%;height:100%;border-radius:4px`;
      track.appendChild(fill);
      const pct = document.createElement('span');
      pct.style.cssText = 'font-size:10px;margin-left:4px';
      pct.textContent = `${val.toFixed(0)}%`;
      row.appendChild(lbl);
      row.appendChild(track);
      row.appendChild(pct);
      barsDiv.appendChild(row);
    };
    addBar('Hunger', hunger, '#f59e0b');
    addBar('Energy', energy, '#22c55e');
    addBar('Social', social, '#a78bfa');
    content.appendChild(barsDiv);

    // Goal — untrusted LLM string: textContent only
    const goalDiv = document.createElement('div');
    goalDiv.style.cssText = 'font-size:11px;color:#fbbf24;margin-bottom:4px';
    goalDiv.textContent = `Goal: ${goal}`;
    content.appendChild(goalDiv);

    // Thought — untrusted LLM string: textContent only
    const thoughtDiv = document.createElement('div');
    thoughtDiv.style.cssText = 'font-size:10px;color:#e2e8f0;background:#1e293b;padding:4px;border-radius:4px;margin-bottom:6px';
    thoughtDiv.textContent = `\u{1F4AD} ${thought || '…'}`;
    content.appendChild(thoughtDiv);

    // Balance (number, no LLM taint)
    const balDiv = document.createElement('div');
    balDiv.style.cssText = 'font-size:11px;color:#64748b;margin-bottom:2px';
    balDiv.textContent = `Balance: ${balance} ¢`;
    content.appendChild(balDiv);

    // Activity log — e.kind and e.detail are untrusted LLM-influenced strings
    const logLabel = document.createElement('div');
    logLabel.style.cssText = 'font-size:11px;color:#94a3b8;margin-bottom:2px';
    logLabel.textContent = 'Activity log:';
    content.appendChild(logLabel);

    const logBox = document.createElement('div');
    logBox.style.cssText = 'max-height:80px;overflow-y:auto;background:#0f172a;padding:4px;border-radius:4px;margin-bottom:6px';
    const recentEvents = events.slice(-10).reverse();
    if (recentEvents.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:10px;color:#64748b';
      empty.textContent = 'No events yet';
      logBox.appendChild(empty);
    } else {
      for (const e of recentEvents) {
        const row = document.createElement('div');
        row.style.cssText = 'font-size:10px;color:#94a3b8';
        row.textContent = `[${e.tick}] ${e.kind}: ${e.detail}`;
        logBox.appendChild(row);
      }
    }
    content.appendChild(logBox);

    // Relationships — agentIdA/B are sim-internal keys (no LLM taint), but
    // still use textContent for uniformity.
    const relLabel = document.createElement('div');
    relLabel.style.cssText = 'font-size:11px;color:#94a3b8;margin-bottom:2px';
    relLabel.textContent = 'Relationships:';
    content.appendChild(relLabel);

    const relBox = document.createElement('div');
    const topRels = rels.slice(0, 5);
    if (topRels.length === 0) {
      const none = document.createElement('div');
      none.style.cssText = 'font-size:10px;color:#64748b';
      none.textContent = 'None yet';
      relBox.appendChild(none);
    } else {
      for (const r of topRels) {
        const other = r.agentIdA === id ? r.agentIdB : r.agentIdA;
        const row = document.createElement('div');
        row.style.cssText = 'font-size:10px;color:#a5f3fc';
        row.textContent = `${other}: ${(r.strength * 100).toFixed(0)}%`;
        relBox.appendChild(row);
      }
    }
    content.appendChild(relBox);
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
