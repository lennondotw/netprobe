import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { LatestResult, RunDetail, RunRecord, TargetResult } from '../shared/types.ts'

/**
 * Results stored by older versions lack fields added since. Fill them in on read so the rest of
 * the app can rely on the current shape.
 */
const normalizeResult = (raw: string): TargetResult => {
  const result = JSON.parse(raw) as TargetResult
  const fixAttempt = (attempt: TargetResult['attempts'][number]) => {
    attempt.detail ??= null
  }
  result.attempts.forEach(fixAttempt)
  for (const download of result.downloads) download.attempts.forEach(fixAttempt)
  if (result.summary) {
    result.summary.jitter ??= null
    result.summary.details ??= []
  }
  return result
}

/**
 * Run history in SQLite. Rows hold JSON documents; the columns only exist for ordering and
 * lookups, so the shapes in `shared/types.ts` stay the single source of truth.
 */
export class Store {
  readonly #db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.#db = new DatabaseSync(path)
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        record TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_created_at ON runs (created_at DESC);
      CREATE TABLE IF NOT EXISTS results (
        run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
        target_id TEXT NOT NULL,
        result TEXT NOT NULL,
        PRIMARY KEY (run_id, target_id)
      );
      CREATE INDEX IF NOT EXISTS results_target ON results (target_id);
    `)
  }

  saveRun(run: RunRecord) {
    this.#db
      .prepare(
        `INSERT INTO runs (id, created_at, record) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET record = excluded.record`,
      )
      .run(run.id, run.createdAt, JSON.stringify(run))
  }

  saveResult(runId: string, result: TargetResult) {
    this.#db
      .prepare(
        `INSERT INTO results (run_id, target_id, result) VALUES (?, ?, ?)
         ON CONFLICT (run_id, target_id) DO UPDATE SET result = excluded.result`,
      )
      .run(runId, result.targetId, JSON.stringify(result))
  }

  listRuns(limit: number): RunRecord[] {
    return this.#db
      .prepare('SELECT record FROM runs ORDER BY created_at DESC LIMIT ?')
      .all(limit)
      .map((row) => JSON.parse(String(row.record)) as RunRecord)
  }

  getRun(id: string): RunDetail | null {
    const row = this.#db.prepare('SELECT record FROM runs WHERE id = ?').get(id)
    if (!row) return null
    const results = this.#db
      .prepare('SELECT result FROM results WHERE run_id = ?')
      .all(id)
      .map((r) => normalizeResult(String(r.result)))
    return { ...(JSON.parse(String(row.record)) as RunRecord), results }
  }

  /** The most recent finished result for every target, across all runs. */
  latestResults(): LatestResult[] {
    return this.#db
      .prepare(
        `SELECT r.result, runs.record
         FROM results r
         JOIN runs ON runs.id = r.run_id
         WHERE json_extract(r.result, '$.status') = 'done'
           AND runs.created_at = (
             SELECT MAX(runs2.created_at) FROM results r2
             JOIN runs runs2 ON runs2.id = r2.run_id
             WHERE r2.target_id = r.target_id AND json_extract(r2.result, '$.status') = 'done'
           )`,
      )
      .all()
      .map((row) => {
        const run = JSON.parse(String(row.record)) as RunRecord
        return {
          runId: run.id,
          createdAt: run.createdAt,
          egressId: run.params.egressId,
          result: normalizeResult(String(row.result)),
        }
      })
  }

  /** Runs left `running` by a previous process can never finish; mark them failed on startup. */
  failInterruptedRuns() {
    for (const run of this.listRuns(1000)) {
      if (run.status !== 'running') continue
      this.saveRun({
        ...run,
        status: 'failed',
        finishedAt: run.finishedAt ?? new Date().toISOString(),
        error: 'The server stopped while this run was in progress.',
      })
    }
  }

  close() {
    this.#db.close()
  }
}
