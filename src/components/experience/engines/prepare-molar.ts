import { createMolarMeshTask, type MolarMeshData, type MolarQuality } from './molar-mesh';
import type { ToothMorphology } from './anatomy';

type GeometryWorker = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener' | 'removeEventListener'>;
interface PreparationOptions {
  signal?: AbortSignal;
  /** Dependency injection for lifecycle tests; production always uses its local module worker. */
  workerFactory?: () => GeometryWorker;
  timeoutMs?: number;
}
const aborted = () => new DOMException('Scene preparation was cancelled.', 'AbortError');

/** Gives the browser an input/paint opportunity and remains cancellable while waiting. */
export function yieldSceneTask(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(aborted()); return; }
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(aborted()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, 0);
    signal?.addEventListener('abort', cancel, {once: true});
  });
}

/** Worker-less browsers keep the same model with bounded cooperative slices. */
export async function prepareMolarOnMainThread(quality: MolarQuality, morphologies: readonly ToothMorphology[], signal?: AbortSignal): Promise<MolarMeshData[]> {
  const meshes: MolarMeshData[] = [];
  for (const morphology of morphologies) {
    const task = createMolarMeshTask(quality, morphology);
    for (;;) {
      await yieldSceneTask(signal);
      const deadline = performance.now() + 4;
      let next = task.next();
      while (!next.done && performance.now() < deadline) next = task.next();
      if (next.done) { meshes.push(next.value); break; }
    }
  }
  if (signal?.aborted) throw aborted();
  return meshes;
}

/** Owns exactly one worker. Every completion, failure, timeout and abort
 * removes listeners and terminates it; no geometry survives an abandoned page. */
export async function prepareMolarMeshes(quality: MolarQuality, morphologies: readonly ToothMorphology[], options: PreparationOptions = {}): Promise<MolarMeshData[]> {
  const {signal} = options;
  if (signal?.aborted) throw aborted();
  if (!options.workerFactory && typeof Worker === 'undefined') return prepareMolarOnMainThread(quality, morphologies, signal);
  try {
    return await new Promise<MolarMeshData[]>((resolve, reject) => {
      const worker = options.workerFactory ? options.workerFactory() : new Worker(new URL('./molar.worker.ts', import.meta.url), {type: 'module', name: 'idealmakoo-anatomy'});
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
        worker.removeEventListener('message', onMessage); worker.removeEventListener('error', onError);
        worker.terminate();
      };
      const finish = (value?: MolarMeshData[], error?: Error) => {
        if (settled) return; settled = true; cleanup();
        if (error) reject(error); else resolve(value!);
      };
      const onAbort = () => finish(undefined, aborted());
      const onError = () => finish(undefined, new Error('The geometry worker could not run.'));
      const onMessage: EventListener = event => {
        const data = (event as MessageEvent<{meshes?: MolarMeshData[]; error?: string}>).data;
        if (data?.error || !Array.isArray(data?.meshes) || data.meshes.length !== morphologies.length || data.meshes.some((mesh, index) => mesh.quality !== quality || mesh.morphology !== morphologies[index] || !(mesh.positions instanceof Float32Array) || !(mesh.indices instanceof Uint16Array || mesh.indices instanceof Uint32Array))) { onError(); return; }
        finish(data.meshes);
      };
      const timer = setTimeout(onError, options.timeoutMs ?? 45000);
      worker.addEventListener('message', onMessage); worker.addEventListener('error', onError);
      signal?.addEventListener('abort', onAbort, {once: true});
      try { worker.postMessage({quality, morphologies}); } catch { onError(); }
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw aborted();
    // Security policies or unavailable workers must never reintroduce a long
    // synchronous meshing task on the interactive thread.
    return prepareMolarOnMainThread(quality, morphologies, signal);
  }
}
