/** A client ID coordinates editing tabs; it never authorizes a server mutation. */
export interface ContentEditorIdentity {
  clientId: string;
  persistence: 'tab' | 'document';
  release: () => void;
}

interface IdentityEnvironment {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  locks?: Pick<LockManager, 'request'>;
  randomUUID: () => string;
}
interface ClaimedIdentity {
  clientId: string;
  persistence: 'tab' | 'document';
  unlock: () => void;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One manager belongs to one document. sessionStorage alone is insufficient:
 * browsers can copy it when duplicating/opening a tab. An exclusive Web Lock
 * detects that copied ID before it can replace another tab's server lease.
 * The lock lives only as long as its callback promise and is released on unload.
 */
export function createContentEditorIdentityManager(environment: IdentityEnvironment) {
  const entries = new Map<string, {references: number; identity: Promise<ClaimedIdentity>}>();
  const freshId = () => {
    const value = environment.randomUUID();
    if (!uuid.test(value)) throw new Error('Invalid editor client identity.');
    return value;
  };
  const claimLock = (name: string) => new Promise<(() => void) | null>((resolve, reject) => {
    // ifAvailable and signal cannot be combined. We never wait behind another
    // document: a copied identity receives a fresh random ID instead.
    void environment.locks!.request(name, {ifAvailable: true}, lock => {
      if (!lock) { resolve(null); return; }
      return new Promise<void>(unlock => resolve(unlock));
    }).catch(reject);
  });
  async function claim(actorId: string): Promise<ClaimedIdentity> {
    if (!environment.locks) {
      // Without exclusive coordination, never trust a possibly copied stored
      // ID. A document-local random ID preserves cross-tab isolation; the
      // token-checked pagehide release remains best effort in older browsers.
      return {clientId: freshId(), persistence: 'document', unlock: () => {}};
    }
    const key = `idealmakoo.content-editor.tab.${encodeURIComponent(actorId)}`;
    let stored: string | null = null;
    try { stored = environment.storage?.getItem(key) || null; } catch { /* Storage may be disabled. */ }
    let candidate = stored && uuid.test(stored) ? stored : freshId();
    for (let attempt = 0; attempt < 4; attempt++) {
      const unlock = await claimLock(`idealmakoo.content-editor.${actorId}.${candidate}`);
      if (unlock) {
        let persisted = candidate === stored;
        try { if (environment.storage) { environment.storage.setItem(key, candidate); persisted = true; } } catch { /* Keep an isolated document identity. */ }
        return {clientId: candidate, persistence: persisted ? 'tab' : 'document', unlock};
      }
      candidate = freshId();
    }
    throw new Error('A unique editing tab identity could not be claimed.');
  }
  return {
    async acquire(actorId: string): Promise<ContentEditorIdentity> {
      if (!actorId || actorId.length > 160) throw new Error('Invalid editor account scope.');
      let entry = entries.get(actorId);
      if (!entry) {
        entry = {references: 0, identity: claim(actorId)};
        entries.set(actorId, entry);
      }
      entry.references++;
      let identity: ClaimedIdentity;
      try { identity = await entry.identity; }
      catch (error) {
        entry.references--;
        if (!entry.references && entries.get(actorId) === entry) entries.delete(actorId);
        throw error;
      }
      let released = false;
      return {
        clientId: identity.clientId,
        persistence: identity.persistence,
        release: () => {
          if (released) return;
          released = true;
          entry.references--;
          if (!entry.references) {
            if (entries.get(actorId) === entry) entries.delete(actorId);
            identity.unlock();
          }
        },
      };
    },
  };
}

let documentManager: ReturnType<typeof createContentEditorIdentityManager> | undefined;
export function acquireContentEditorIdentity(actorId: string) {
  if (typeof window === 'undefined') throw new Error('An editing identity requires a browser document.');
  if (!documentManager) {
    let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* Never substitute shared localStorage. */ }
    documentManager = createContentEditorIdentityManager({storage, locks: navigator.locks, randomUUID: () => crypto.randomUUID()});
  }
  return documentManager.acquire(actorId);
}
