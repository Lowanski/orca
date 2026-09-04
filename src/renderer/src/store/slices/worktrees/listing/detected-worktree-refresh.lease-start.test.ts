import { afterEach, describe, expect, it, vi } from 'vitest'
import { rememberLeaseStart } from './detected-worktree-refresh'

describe('rememberLeaseStart', () => {
  afterEach(() => vi.useRealTimers())

  // Regression: the direct-SSH path recorded the start inside merge, after the provider completed,
  // so the first owner stamped completion time and every joiner inherited a time later than a
  // write that had landed mid-scan.
  it("keeps the first caller's clock for every later joiner of the same request", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const first = rememberLeaseStart('req-shared-start')
    vi.setSystemTime(9_000)
    const joiner = rememberLeaseStart('req-shared-start')

    expect(first).toBe(1_000)
    expect(joiner).toBe(1_000)
  })

  it('records a fresh start for a different request', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    rememberLeaseStart('req-a-distinct')
    vi.setSystemTime(5_000)
    expect(rememberLeaseStart('req-b-distinct')).toBe(5_000)
  })
})
