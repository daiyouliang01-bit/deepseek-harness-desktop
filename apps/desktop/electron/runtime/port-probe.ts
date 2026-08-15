/** Task 1.2 — free-port probing (ADR-007). */

/**
 * Check whether a TCP port on 127.0.0.1 is currently free by attempting to
 * bind it. Returns true when bindable. Used when a caller wants a concrete
 * port before spawning (the `--port 0` flow needs no probing — the OS assigns
 * — but callers that pre-reserve a port use this).
 */
export async function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  const { createServer } = await import('node:net')
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen({ port, host }, () => {
      server.close(() => resolve(true))
    })
  })
}

/**
 * Return the first free port starting at `from` (inclusive), probing upward.
 * Returns null when none found within `maxAttempts`.
 */
export async function findFreePort(from = 49152, maxAttempts = 100): Promise<number | null> {
  for (let port = from; port < from + maxAttempts; port++) {
    if (await isPortFree(port)) return port
  }
  return null
}
