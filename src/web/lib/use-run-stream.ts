import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { RunDetail, RunEvent } from '../../shared/types.ts'
import { queryKeys } from './api.ts'

/**
 * Follow a run over server-sent events. Returns the live run (null until the first snapshot).
 * When the run settles, the history and latest-result queries are refreshed.
 */
export const useRunStream = (runId: string | null) => {
  const queryClient = useQueryClient()
  const [run, setRun] = useState<RunDetail | null>(null)

  useEffect(() => {
    if (!runId) return
    const source = new EventSource(`/api/runs/${runId}/events`)

    source.onmessage = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as RunEvent
      setRun((current) => {
        if (event.type === 'snapshot') return event.run
        if (!current) return current
        if (event.type === 'run') return { ...current, ...event.run }
        return {
          ...current,
          results: current.results.map((r) =>
            r.targetId === event.result.targetId ? event.result : r,
          ),
        }
      })
      if (event.type === 'run' && event.run.status !== 'running') {
        source.close()
        void queryClient.invalidateQueries({ queryKey: queryKeys.latest })
        void queryClient.invalidateQueries({ queryKey: queryKeys.runs })
        void queryClient.invalidateQueries({ queryKey: queryKeys.config })
        void queryClient.invalidateQueries({ queryKey: queryKeys.run(runId) })
      }
    }
    return () => source.close()
  }, [runId, queryClient])

  return run?.id === runId ? run : null
}
