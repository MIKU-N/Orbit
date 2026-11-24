import type React from 'react';
import { createContext, useContext } from 'react';
import type { HostAPI } from './types';

const OrbitHostContext = createContext<HostAPI | null>(null);

export function OrbitHostProvider({
  host,
  children,
}: {
  host: HostAPI;
  children: React.ReactNode;
}) {
  return <OrbitHostContext.Provider value={host}>{children}</OrbitHostContext.Provider>;
}

export function useOrbitHost(): HostAPI {
  const ctx = useContext(OrbitHostContext);
  if (!ctx) {
    throw new Error('useOrbitHost must be used within OrbitHostProvider');
  }
  return ctx;
}
