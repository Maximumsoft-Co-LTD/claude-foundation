export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = body.error || msg;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) {
    return undefined as unknown as T;
  }
  return res.json();
}

export type Case = {
  id: string;
  title: string;
  notes: string;
  tags: string[];
  status: 'open' | 'closed' | 'archived';
  created_at: string;
  updated_at: string;
};

export type CaseFile = {
  id: string;
  filename: string;
  included: boolean;
  headers: string[];
  mapping?: { SourceCol: string; TargetCol: string; WeightCol: string };
};

export type GraphNode = { ID: string; Attrs?: Record<string, string> };
export type GraphEdge = {
  Source: string;
  Target: string;
  Weight: number;
  RowIndex: number;
  FileID: string;
};
export type Graph = { Nodes: GraphNode[]; Edges: GraphEdge[] };

export type NodeDetail = {
  node_id: string;
  edges: Array<{
    source: string;
    target: string;
    weight: number;
    file_id: string;
    filename: string;
    row_index: number;
  }>;
};

export type CaseFilters = {
  title?: string;
  tag?: string;
  status?: string;
  from?: string;
  to?: string;
};

export const api = {
  listCases: (f: CaseFilters = {}) => {
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    const qs = params.toString();
    return request<Case[]>(`/cases${qs ? `?${qs}` : ''}`);
  },
  createCase: (body: { title: string; notes: string; tags: string[] }) =>
    request<Case>('/cases', { method: 'POST', body: JSON.stringify(body) }),
  getCase: (id: string) => request<Case>(`/cases/${id}`),
  patchCase: (id: string, body: Partial<Case>) =>
    request<Case>(`/cases/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveCase: (id: string) =>
    request<void>(`/cases/${id}/archive`, { method: 'POST' }),
  listFiles: (id: string) => request<CaseFile[]>(`/cases/${id}/files`),
  uploadFile: async (
    id: string,
    file: File,
  ): Promise<{ file_id: string; headers: string[] }> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BASE}/api/v1/cases/${id}/files`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const body = await res.json();
        msg = body.error || msg;
      } catch {}
      throw new ApiError(res.status, msg);
    }
    return res.json();
  },
  setMapping: (
    caseID: string,
    fileID: string,
    m: { source_col: string; target_col: string; weight_col: string },
  ) =>
    request<{ node_count: number; edge_count: number }>(
      `/cases/${caseID}/files/${fileID}/mapping`,
      { method: 'PATCH', body: JSON.stringify(m) },
    ),
  setIncluded: (caseID: string, fileID: string, included: boolean) =>
    request<void>(`/cases/${caseID}/files/${fileID}/included`, {
      method: 'PATCH',
      body: JSON.stringify({ included }),
    }),
  getGraph: (id: string) => request<Graph>(`/cases/${id}/graph`),
  getNodeDetail: (id: string, nodeID: string) =>
    request<NodeDetail>(`/cases/${id}/nodes/${encodeURIComponent(nodeID)}`),
  exportGraphURL: (id: string) =>
    `${BASE}/api/v1/cases/${id}/graph/export.json`,
};
