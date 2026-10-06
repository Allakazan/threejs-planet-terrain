import { buildChunk } from './chunkGeometry'
import type { WorkerMessage } from './chunkGeometry'
import { registerTerrainSpec } from './terrain/LayeredTerrain'

/**
 * Worker entry. It calls the same pure `buildChunk` the main thread calls when
 * `USE_WORKERS = false`, so there is only ever one implementation of the terrain
 * maths to debug. The only other message is a terrain spec, which it registers
 * under its version so later requests can build that terrain.
 *
 * The two arrays are **transferred**, not copied. The index and UV buffers are
 * never sent at all — they are shared, built once on the main thread.
 */
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data
  if (message.kind === 'terrain') {
    registerTerrainSpec(message.version, message.spec)
    return
  }

  const result = buildChunk(message.req)
  // `self` is typed as a Window here because the app's lib is DOM; the cast picks
  // up `Worker.postMessage(message, transfer)`, which is the signature in play.
  const transfer: ArrayBuffer[] = [result.positions.buffer, result.normals.buffer]
  if (result.bake !== null) transfer.push(result.bake.buffer)
  ;(self as unknown as Worker).postMessage(result, transfer)
}
