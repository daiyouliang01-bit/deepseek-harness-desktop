// src/client/api.ts
// HTTP JSON-RPC wrapper for /preview/api (replaces harness.handle ↔ host.call).

export async function fpCall<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('/preview/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fn, ...args }),
  })
  if (!res.ok) throw new Error(`fp ${fn} failed: ${res.status} ${await res.text().catch(() => '')}`.trim())
  return res.json() as Promise<T>
}
