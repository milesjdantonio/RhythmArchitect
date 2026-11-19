// A value outside React that components subscribe to, so a fast-changing one (the run panel's
// numbers, ten times a second) re-renders only what shows it, not the whole screen holding it.

import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  /** A new value, or a function of the old one (returning the same object changes nothing). */
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

/** What a component that only shows a store needs. */
export type ReadStore<T> = Pick<Store<T>, 'get' | 'subscribe'>;

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      const v = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
      if (Object.is(v, value)) return;
      value = v;
      listeners.forEach((l) => l());
    },
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

/** The store's value, re-rendering the component when it changes. */
export function useStore<T>(store: ReadStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
