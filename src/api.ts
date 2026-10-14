import type { AiRequest, AiStreamEvent } from '../shared/types';

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('无法连接到本地服务，请确认程序仍在运行');
  }
  if (!res.ok) {
    let msg = '';
    try {
      msg = (await res.json()).error;
    } catch {
      /* not json */
    }
    throw new ApiError(msg || `请求失败（${res.status}）`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T = { ok: boolean }>(path: string) => request<T>('DELETE', path),
};

/** 页面关闭时尽力保存 */
export function patchKeepalive(path: string, body: unknown) {
  try {
    fetch('/api' + path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    /* ignore */
  }
}

export interface AiHandlers {
  onMeta?: (provider: string, model: string) => void;
  onText?: (chunk: string, full: string) => void;
  onReasoning?: (chunk: string, full: string) => void;
}

export async function runAi(req: AiRequest, handlers: AiHandlers, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch('/api/ai/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('无法连接到本地服务');
  }
  if (!res.ok || !res.body) {
    let msg = '';
    try {
      msg = (await res.json()).error;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg || `请求失败（${res.status}）`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let reasoning = '';
  const handle = (line: string) => {
    if (!line.trim()) return;
    const ev = JSON.parse(line) as AiStreamEvent;
    if (ev.t === 'meta') handlers.onMeta?.(ev.provider, ev.model);
    else if (ev.t === 'text') {
      text += ev.v;
      handlers.onText?.(ev.v, text);
    } else if (ev.t === 'reasoning') {
      reasoning += ev.v;
      handlers.onReasoning?.(ev.v, reasoning);
    } else if (ev.t === 'error') throw new ApiError(ev.v);
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      handle(line);
    }
  }
  handle(buffer + decoder.decode());
  return { text, reasoning };
}

export function downloadUrl(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
