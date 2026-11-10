/** Where the 3D pages (hero-lab) are served. Set VITE_LAB_URL when deploying; defaults to the local dev server. */
export const LAB: string = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_LAB_URL ?? 'http://localhost:5212';
