/** Task 4.2 — terminal / job status model (pure). */

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface Job {
  id: string
  command: string
  status: JobStatus
  exitCode?: number
  startedAt: number
  finishedAt?: number
  output: string[]
}

export class JobTracker {
  private jobs = new Map<string, Job>()
  private seq = 0

  submit(command: string): Job {
    const job: Job = { id: crypto.randomUUID(), command, status: 'queued', startedAt: Date.now(), output: [] }
    this.jobs.set(job.id, job)
    return job
  }

  start(id: string): void {
    const job = this.jobs.get(id)
    if (job && job.status === 'queued') job.status = 'running'
  }

  appendOutput(id: string, line: string): void {
    const job = this.jobs.get(id)
    if (job) job.output.push(line)
  }

  finish(id: string, exitCode: number): void {
    const job = this.jobs.get(id)
    if (job) {
      job.status = exitCode === 0 ? 'succeeded' : 'failed'
      job.exitCode = exitCode
      job.finishedAt = Date.now()
    }
  }

  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (job && (job.status === 'queued' || job.status === 'running')) {
      job.status = 'cancelled'
      job.finishedAt = Date.now()
    }
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => {
      const byTime = b.startedAt - a.startedAt
      return byTime !== 0 ? byTime : this.seqOf(b.id) - this.seqOf(a.id)
    })
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id)
  }

  private seqOf(id: string): number {
    // insertion order fallback: reuse map iteration index
    let i = 0
    for (const key of this.jobs.keys()) {
      if (key === id) return i
      i++
    }
    return 0
  }
}
