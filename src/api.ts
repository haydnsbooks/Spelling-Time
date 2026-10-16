import { appConfig } from './config';

type Payload = Record<string, unknown>;
type Method = 'GET' | 'POST';

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: Method, payload: Payload): Promise<T> {
  const endpoint = appConfig?.SHEETS_URL?.trim();
  if (!endpoint) throw new ApiError('The Google Sheet link is not configured.');

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25_000);
  try {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined && value !== null) query.set(key, String(value));
    }
    const response = await fetch(method === 'GET' ? `${endpoint}?${query}` : endpoint, {
      method,
      signal: controller.signal,
      ...(method === 'POST'
        ? { headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) }
        : {})
    });
    if (!response.ok) throw new ApiError(`The Google Sheet returned ${response.status}.`, response.status);
    const result = await response.json() as { ok?: boolean; error?: string; busy?: boolean } & T;
    if (result.ok === false) throw new ApiError(result.error || 'The Google Sheet returned an error.');
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError('The Google Sheet took too long to respond.');
    if (!navigator.onLine) throw new ApiError('This device is offline. Check the internet connection.');
    throw new ApiError('The Google Sheet did not respond. Check the connection and try again.');
  } finally {
    window.clearTimeout(timeout);
  }
}

export const api = {
  get: <T>(payload: Payload) => request<T>('GET', { ...payload, action: String(payload.action || '') }),
  post: <T>(payload: Payload) => request<T>('POST', { ...payload, action: String(payload.action || '') })
};
