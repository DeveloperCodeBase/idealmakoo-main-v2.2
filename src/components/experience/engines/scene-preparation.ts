import type {Camera, Object3D, Scene, WebGLRenderer, WebGLRenderTarget} from 'three';

interface VariantPreparationOptions {
  /** Reflectors are absent from their own offscreen capture. */
  excludeFromTarget?: readonly Object3D[];
  cancelled?: () => boolean;
}

/**
 * Canvas programs use output tone mapping/color conversion; reflection and
 * transmission targets use linear output. Compile both actual variants before
 * drawing, without rendering or changing a material, camera or scene object.
 */
export async function compileSceneVariants(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  renderTarget: WebGLRenderTarget,
  options: VariantPreparationOptions = {},
): Promise<void> {
  const cancelled = options.cancelled || (() => false);
  const excluded = new Set(options.excludeFromTarget || []);
  const targetObjects: Object3D[] = [];
  scene.traverse(object => {
    const drawable = object as Object3D & {isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean};
    if (!excluded.has(object) && (drawable.isMesh || drawable.isPoints || drawable.isLine || drawable.isSprite)) targetObjects.push(object);
  });

  function compile(object: Object3D, target: WebGLRenderTarget | null): Promise<unknown> {
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousLevel = renderer.getActiveMipmapLevel();
    try {
      renderer.setRenderTarget(target);
      // compileAsync submits its programs synchronously. Restore state before
      // yielding, so resize/HDR callbacks never inherit the preparation target.
      return renderer.compileAsync(object, camera, scene);
    } finally {
      renderer.setRenderTarget(previousTarget, previousFace, previousLevel);
    }
  }

  if (cancelled()) return;
  await compile(scene, null);
  for (const object of targetObjects) {
    if (cancelled()) return;
    // Three r180 polls each material's currentProgram. Await each variant
    // before selecting another; concurrent compiles could wait on the wrong one.
    await compile(object, renderTarget);
  }
}

/** A visibility event cannot schedule an unprepared or failed scene. */
export function createScenePreparationGate() {
  let state: 'pending' | 'ready' | 'failed' | 'cancelled' = 'pending';
  let operation: Promise<boolean> | null = null;
  return {
    prepare(prepare?: () => Promise<void>): Promise<boolean> {
      if (operation) return operation;
      if (state !== 'pending') return Promise.resolve(false);
      operation = (async () => {
        try {
          await prepare?.();
          if (state !== 'pending') return false;
          state = 'ready';
          return true;
        } catch (error) {
          if (state === 'pending') state = 'failed';
          throw error;
        }
      })();
      return operation;
    },
    canDraw(inViewport: boolean, documentHidden: boolean): boolean {
      return state === 'ready' && inViewport && !documentHidden;
    },
    fail() { if (state !== 'cancelled') state = 'failed'; },
    cancel() { state = 'cancelled'; },
  };
}
