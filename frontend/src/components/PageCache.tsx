import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

const RESOURCES = ['collection', 'monitor', 'sources'] as const;
type Resource = typeof RESOURCES[number];
const initialVersions = { collection: 0, monitor: 0, sources: 0 };
const Changes = createContext({ versions: initialVersions, invalidate: (_resources?: readonly Resource[]) => {} });
const Visible = createContext(true);

export function PageCacheProvider({ children }: { children: ReactNode }) {
  const [versions, setVersions] = useState(initialVersions);
  const invalidate = useCallback((resources: readonly Resource[] = RESOURCES) => {
    setVersions(current => {
      const next = { ...current };
      for (const resource of resources) next[resource]++;
      return next;
    });
  }, []);
  const value = useMemo(() => ({ versions, invalidate }), [versions, invalidate]);
  return <Changes.Provider value={value}>{children}</Changes.Provider>;
}

export const usePageVisible = () => useContext(Visible);
export const useInvalidatePages = () => useContext(Changes).invalidate;

// Keep the first loaded view until the account workspace is unmounted.
export function KeepAlive({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  const visible = usePageVisible() && active;
  const scroll = useRef(0);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  useLayoutEffect(() => {
    if (!visible) return;
    window.scrollTo(0, scroll.current);
    const remember = () => { scroll.current = window.scrollY; };
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, [visible]);
  if (!visited && !active) return null;
  return <Visible.Provider value={visible}><div className="space-y-5" hidden={!active}>{children}</div></Visible.Provider>;
}

// Navigation reuses the view; a changed query or successful write refreshes its data.
export function useCachedLoad(resource: Resource, load: () => void) {
  const visible = usePageVisible(), version = useContext(Changes).versions[resource];
  const previous = useRef<{ version: number; load: () => void } | null>(null);
  useEffect(() => {
    if (!visible || (previous.current?.version === version && previous.current.load === load)) return;
    previous.current = { version, load };
    load();
  }, [visible, version, load]);
}
