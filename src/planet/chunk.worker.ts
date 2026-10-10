import { buildChunk } from './chunkGeometry'
import type { WorkerMessage } from './chunkGeometry'
import { registerTerrainBuild } from './terrain/LayeredTerrain'

/**
 * Worker entry. It calls the same pure `buildChunk` the main thread calls when
 * `USE_WORKERS = false`, so there is only ever one implementation of the terrain
 * maths to debug. The only other message is a terrain build (spec + bake
 * settings), which it registers under its version so later requests can use it.
 *
 * The two arrays are **transferred**, not copied. The index and UV buffers are
 * never sent at all — they are shared, built once on the main thread.
 */
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data
  if (message.kind === 'terrain') {
    registerTerrainBuild(message.version, message.build)
    return
  }

  const result = buildChunk(message.req)
  // `self` is typed as a Window here because the app's lib is DOM; the cast picks
  // up `Worker.postMessage(message, transfer)`, which is the signature in play.
  const transfer: ArrayBuffer[] = [result.positions.buffer, result.normals.buffer]
  if (result.bake !== null) transfer.push(result.bake.buffer)
  ;(self as unknown as Worker).postMessage(result, transfer)
}
