export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  let msg = res.statusText;
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string') {
      msg = body.error;
    }
  } catch {
    // body was not JSON; keep statusText
  }
  throw new ApiError(res.status, msg);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  await throwIfNotOk(res);
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

export type ColumnMapping = {
  source_col: string;
  target_col: string;
  weight_col?: string;
};

export type CaseFile = {
  id: string;
  filename: string;
  included: boolean;
  headers: string[];
  mapping?: ColumnMapping;
};

export type GraphNode = { id: string; attrs?: Record<string, string> };
export type GraphEdge = {
  source: string;
  target: string;
  weight: number;
  row_index: number;
  file_id: string;
  attrs?: Record<string, string>;
};

export type MergeConflict = {
  node_id: string;
  key: string;
  old_value: string;
  new_value: string;
  old_file_id: string;
  new_file_id: string;
};

export type Graph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  conflicts?: MergeConflict[];
};

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
  conflicts?: MergeConflict[];
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
    await throwIfNotOk(res);
    return res.json();
  },
  setMapping: (
    caseID: string,
    fileID: string,
    m: { source_col: string; target_col: string; weight_col?: string },
  ) =>
    request<{
      node_count: number;
      edge_count: number;
      rows_seen: number;
      rows_emitted: number;
      rows_skipped_short: number;
      rows_skipped_blank: number;
      weights_unparsed: number;
    }>(`/cases/${caseID}/files/${fileID}/mapping`, {
      method: 'PATCH',
      body: JSON.stringify(m),
    }),
  setIncluded: (caseID: string, fileID: string, included: boolean) =>
    request<void>(`/cases/${caseID}/files/${fileID}/included`, {
      method: 'PATCH',
      body: JSON.stringify({ included }),
    }),
  getGraph: (id: string) => request<Graph>(`/cases/${id}/graph`),
  getNodeDetail: (id: string, nodeID: string) =>
    request<NodeDetail>(
      `/cases/${id}/nodes/${encodeURIComponent(nodeID)}`,
    ),
  exportGraphURL: (id: string) =>
    `${BASE}/api/v1/cases/${id}/graph/export.json`,
};
