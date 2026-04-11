export interface ApiResponse<T = unknown> {
  data: T | null;
  error: { code: string; message: string; details?: Record<string, string[]> } | null;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<ApiResponse<T>> {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  return res.json();
}

export const api = {
  get: <T>(url: string, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<T>('GET', url + qs);
  },
  post: <T>(url: string, body: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
};
