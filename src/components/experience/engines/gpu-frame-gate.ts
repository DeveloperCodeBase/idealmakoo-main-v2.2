/** At most one submitted frame may still be outstanding. Polling never waits:
 * input, scene time and animation state can continue while drawing is deferred. */
export function createGpuFrameGate(gl: WebGL2RenderingContext) {
  let pending: WebGLSync | null = null, disposed = false;
  const release = () => {
    const sync = pending; pending = null;
    if (sync) gl.deleteSync(sync);
  };
  const fail = (message: string): never => {
    disposed = true;
    try { release(); } finally { throw new Error(message); }
  };
  const assertLive = () => {
    if (disposed) throw new Error('The GPU frame gate is disposed.');
    if (gl.isContextLost()) fail('The GPU context was lost.');
  };
  return {
    canDraw(): boolean {
      assertLive();
      if (!pending) return true;
      let status: number;
      try { status = gl.clientWaitSync(pending, 0, 0); }
      catch { return fail('The GPU completion poll failed.'); }
      if (status === gl.TIMEOUT_EXPIRED) return false;
      if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED)
        return fail('The GPU completion fence failed.');
      try { release(); } catch { return fail('The GPU completion fence could not be released.'); }
      return true;
    },
    didDraw(): void {
      assertLive();
      if (pending) fail('A GPU frame is already outstanding.');
      try {
        pending = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (!pending) fail('The GPU completion fence could not be created.');
        gl.flush();
      } catch { fail('The GPU frame could not be submitted.'); }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true; release();
    },
  };
}
