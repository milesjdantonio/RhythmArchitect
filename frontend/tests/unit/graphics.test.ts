import { afterEach, describe, expect, it, vi } from 'vitest';

/** A browser whose WebGL says `renderer`, with `cores` and `memory` (GB, or none). */
function browser(renderer: string | null, cores = 8, memory?: number) {
  const gl = renderer == null ? null : {
    getExtension: (n: string) => (n === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 1 } : null),
    getParameter: () => renderer,
    RENDERER: 2,
  };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => gl }) });
  vi.stubGlobal('navigator', { hardwareConcurrency: cores, ...(memory !== undefined ? { deviceMemory: memory } : {}) });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
}

/** A fresh copy of the modules (Auto measures once, and the settings load once). */
async function load() {
  vi.resetModules();
  return { G: await import('../../src/lib/graphics'), S: await import('../../src/lib/settings') };
}

describe('graphics levels (lib/graphics.ts)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Auto: Simple with no graphics chip or no WebGL, Light on a small machine or an old built-in chip, else Full', async () => {
    browser('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)');
    expect((await load()).G.detectGraphics().level).toBe('simple');
    browser(null);
    expect((await load()).G.detectGraphics().level).toBe('simple');
    browser('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)', 4);
    expect((await load()).G.detectGraphics()).toEqual({ level: 'light', why: '4 processor cores' });
    browser('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)', 8, 4);
    expect((await load()).G.detectGraphics().level).toBe('light');
    browser('ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11)', 8, 8);
    expect((await load()).G.detectGraphics().level).toBe('light');
    browser('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)', 16, 16);
    expect((await load()).G.detectGraphics().level).toBe('full');
  });

  it('the setting wins over Auto, and Simple stills the menus (isCalm)', async () => {
    browser('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)', 16, 16);
    const { G, S } = await load();
    expect(G.graphicsLevel()).toBe('full');
    S.setSettings({ graphics: 'light' });
    expect(G.graphicsLevel()).toBe('light');
    S.setSettings({ graphics: 'simple' });
    expect(G.graphicsLevel()).toBe('simple');
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(S.isCalm()).toBe(true);
  });
});
