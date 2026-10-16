import { useQuery } from '@tanstack/react-query'

import type {
  AppConfig,
  LatestResult,
  RunDetail,
  RunParams,
  RunRecord,
} from '../../shared/types.ts'

export class ApiError extends Error {}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String(body.error)
        : `HTTP ${response.status}`
    throw new ApiError(message)
  }
  return body as T
}

export const queryKeys = {
  config: ['config'] as const,
  latest: ['latest'] as const,
  runs: ['runs'] as const,
  run: (id: string) => ['run', id] as const,
}

// Polled so a page notices runs started elsewhere (another viewer, another tab).
export const useConfig = () =>
  useQuery({
    queryKey: queryKeys.config,
    queryFn: () => request<AppConfig>('/api/config'),
    refetchInterval: 5_000,
  })

export const useLatest = () =>
  useQuery({ queryKey: queryKeys.latest, queryFn: () => request<LatestResult[]>('/api/latest') })

export const useRuns = () =>
  useQuery({ queryKey: queryKeys.runs, queryFn: () => request<RunRecord[]>('/api/runs?limit=200') })

export const useRun = (id: string) =>
  useQuery({ queryKey: queryKeys.run(id), queryFn: () => request<RunDetail>(`/api/runs/${id}`) })

export const startRun = (params: RunParams) =>
  request<RunRecord>('/api/runs', { method: 'POST', body: JSON.stringify(params) })

export const cancelRun = (id: string) =>
  request<{ ok: true }>(`/api/runs/${id}/cancel`, { method: 'POST' })
