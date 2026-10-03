import { Vector3 } from 'three'
import { MAX_UPLOADS_PER_FRAME, USE_WORKERS, WORKER_COUNT } from '../core/constants'
import { buildChunk } from './chunkGeometry'
import type { ChunkRequest, ChunkResult, WorkerMessage } from './chunkGeometry'
import { terrainSpecFor } from './terrain/LayeredTerrain'

/** Smoothing of the HUD's build-time average, per arriving chunk. */
const BUILD_MS_SMOOTHING = 0.05

type Job = {
  readonly req: ChunkRequest
  /**
   * Absolute position of the patch centre. Never sent to the worker — it exists
   * only so the queue can be re-prioritised against the player every frame.
   */
  readonly centreAbs: Vector3
  readonly onReady: (result: ChunkResult) => void
}

/** Everything but the id, which the pool assigns. */
export type ChunkSpec = Omit<ChunkRequest, 'id'>

/**
 * Fixed pool of workers in front of a distance-prioritised queue.
 *
 * Lives at module scope (see the singleton at the bottom) because StrictMode
 * double-mounts every effect in dev, and a pool built inside one would spawn two
 * sets of workers.
 */
export class ChunkWorkerPool {
  private readonly workers: Worker[] = []
  private readonly idle: Worker[] = []

  /**
   * Unordered. Position in the array carries no meaning — priority is recomputed
   * from the live player position on every dispatch, which is why removal can be
   * a swap-pop and why a plain array beats a heap here: the keys all change every
   * frame, so a heap would be rebuilt constantly anyway.
   */
  private readonly queue: Job[] = []

  /** Dispatched and not yet answered, by request id. */
  private readonly inFlight = new Map<number, Job>()

  /** Ids whose worker is still busy but whose node has gone away. */
  private readonly abandoned = new Set<number>()

  /** Finished, waiting on the per-frame upload budget. */
  private readonly arrived: { job: Job; result: ChunkResult }[] = []

  /** The newest terrain version each worker has been sent. */
  private readonly terrainSent = new Map<Worker, number>()

  private nextId = 1

  /** Exponential moving average of chunk build time, ms. */
  buildMs = 0

  constructor() {
    if (!USE_WORKERS) return
    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = new Worker(new URL('./chunk.worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.onmessage = (event: MessageEvent<ChunkResult>) => this.onDone(worker, event.data)
      this.workers.push(worker)
      this.idle.push(worker)
    }
  }

  /** Queues a chunk build. Returns the id to pass to `cancel`. */
  request(spec: ChunkSpec, centreAbs: Vector3, onReady: (result: ChunkResult) => void): number {
    const id = this.nextId++
    this.queue.push({ req: { ...spec, id }, centreAbs, onReady })
    return id
  }

  /**
   * Drops a request wherever it currently sits. Safe to call for an id that has
   * already been delivered — a node only cancels while it is still `Pending`, but
   * the three-stage check below means a stale id leaks nothing either way.
   */
  cancel(id: number): void {
    const queued = this.queue.findIndex((job) => job.req.id === id)
    if (queued >= 0) {
      swapPop(this.queue, queued)
      return
    }

    if (this.inFlight.delete(id)) {
      // A worker is mid-build. Let it finish and throw the answer away on arrival.
      this.abandoned.add(id)
      return
    }

    const waiting = this.arrived.findIndex((entry) => entry.result.id === id)
    if (waiting >= 0) swapPop(this.arrived, waiting)
  }

  /**
   * One step of the pipeline. Called once per frame by the quadtree, after the
   * split/merge walk, so the queue is already up to date for this frame.
   */
  pump(playerAbs: Vector3): void {
    this.dispatch(playerAbs)
    this.deliver()
  }

  private dispatch(playerAbs: Vector3): void {
    if (USE_WORKERS) {
      while (this.idle.length > 0 && this.queue.length > 0) {
        const job = this.takeNearest(playerAbs)
        if (job === undefined) return
        const worker = this.idle.pop()!
        this.inFlight.set(job.req.id, job)
        this.sendTerrain(worker, job.req.terrainVersion)
        worker.postMessage({ kind: 'chunk', req: job.req } satisfies WorkerMessage)
      }
      return
    }

    // Synchronous fallback: the same budget as the uploads, so a debugging session
    // without workers degrades to a slower build rather than a frozen tab.
    for (let built = 0; built < MAX_UPLOADS_PER_FRAME && this.queue.length > 0; built++) {
      const job = this.takeNearest(playerAbs)
      if (job === undefined) return
      this.arrived.push({ job, result: buildChunk(job.req) })
    }
  }

  /**
   * Workers build their terrain from a spec they hold locally, so a request for a
   * version a worker has not seen is preceded by that version's spec. A worker
   * handles its messages in order, so the spec is always registered first.
   */
  private sendTerrain(worker: Worker, version: number): void {
    if ((this.terrainSent.get(worker) ?? 0) >= version) return
    worker.postMessage({ kind: 'terrain', version, spec: terrainSpecFor(version) } satisfies WorkerMessage)
    this.terrainSent.set(worker, version)
  }

  private deliver(): void {
    for (let i = 0; i < MAX_UPLOADS_PER_FRAME && this.arrived.length > 0; i++) {
      // Shift is fine: `arrived` holds at most WORKER_COUNT entries.
      const entry = this.arrived.shift()!
      this.buildMs += (entry.result.buildMs - this.buildMs) * BUILD_MS_SMOOTHING
      entry.job.onReady(entry.result)
    }
  }

  private onDone(worker: Worker, result: ChunkResult): void {
    this.idle.push(worker)

    if (this.abandoned.delete(result.id)) return

    const job = this.inFlight.get(result.id)
    if (job === undefined) return
    this.inFlight.delete(result.id)
    this.arrived.push({ job, result })
  }

  /** Nearest-first. A full scan of a queue this size is cheaper than maintaining order. */
  private takeNearest(playerAbs: Vector3): Job | undefined {
    const { queue } = this
    if (queue.length === 0) return undefined

    let best = 0
    let bestDistance = queue[0].centreAbs.distanceToSquared(playerAbs)
    for (let i = 1; i < queue.length; i++) {
      const distance = queue[i].centreAbs.distanceToSquared(playerAbs)
      if (distance < bestDistance) {
        bestDistance = distance
        best = i
      }
    }
    return swapPop(queue, best)
  }

  get queued(): number {
    return this.queue.length
  }

  get inFlightCount(): number {
    return this.inFlight.size
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate()
    this.workers.length = 0
    this.idle.length = 0
    this.queue.length = 0
    this.arrived.length = 0
    this.inFlight.clear()
    this.abandoned.clear()
    this.terrainSent.clear()
  }
}

/** Removes index `i` in O(1) by moving the last element into the hole. */
function swapPop<T>(array: T[], i: number): T {
  const picked = array[i]
  const last = array.pop()!
  if (i < array.length) array[i] = last
  return picked
}

export const chunkWorkerPool = new ChunkWorkerPool()

// Vite re-executes this module on HMR, which would otherwise strand the old
// workers running forever.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    chunkWorkerPool.dispose()
  })
}
