// The receipt measurement (SPEC §7) through the WebAssembly build of the probe's canonical pass.
//
// Receipts are defined by this build: WebAssembly arithmetic is specified exactly, so the same
// .wasm computes bit-identical masses on every machine and in every browser, which native builds
// (whose kernels depend on the CPU) do not. The brain measures with it, and every verifier
// (tools/verify-receipt.ts, the site's replay button) replays with it.
//
// Works in Node and in a Web Worker: the caller instantiates the module and mounts the model file
// (NODEFS in Node, WORKERFS in a worker), then hands both here.

import { SEGMENT_COUNT } from './model.ts';

/** The parts of the Emscripten module this uses. */
export type NeuralsWasm = {
  ccall(name: string, ret: 'number', types: string[], args: unknown[]): number;
  _malloc(n: number): number;
  _free(p: number): void;
  _neurals_measure(prompt: number, np: number, reply: number, nr: number, out: number): number;
  HEAP32: Int32Array;
  HEAPF64: Float64Array;
};

export class WasmMeasurer {
  private readonly m: NeuralsWasm;

  /** `modelPath` is the model's path inside the module's file system. */
  constructor(m: NeuralsWasm, modelPath: string) {
    this.m = m;
    if (m.ccall('neurals_load', 'number', ['string'], [modelPath]) !== 0) throw new Error(`the model did not load from ${modelPath}`);
  }

  /** Activation masses (model order) of the canonical pass over prompt + reply. */
  measure(prompt: readonly number[], reply: readonly number[]): number[] {
    const m = this.m;
    const ints = (xs: readonly number[]) => { const p = m._malloc(xs.length * 4); m.HEAP32.set(xs, p >> 2); return p; };
    const pp = ints(prompt);
    const rp = ints(reply);
    const out = m._malloc(SEGMENT_COUNT * 8);
    try {
      const n = m._neurals_measure(pp, prompt.length, rp, reply.length, out);
      if (n !== SEGMENT_COUNT) throw new Error(`the verifier returned ${n}`);
      const mass = Array.from(m.HEAPF64.subarray(out >> 3, (out >> 3) + SEGMENT_COUNT));
      for (const x of mass) if (!Number.isFinite(x)) throw new Error('the verifier produced a non-finite mass');
      return mass;
    } finally {
      m._free(pp);
      m._free(rp);
      m._free(out);
    }
  }
}

/** Loads the verifier in Node with the model's folder mounted. */
export async function loadWasmInNode(wasmJs: string, modelFile: string): Promise<WasmMeasurer> {
  const { dirname, basename, resolve } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const factory = (await import(pathToFileURL(resolve(wasmJs)).href)).default as () => Promise<NeuralsWasm & { FS: any }>;
  const m = await factory();
  m.FS.mkdir('/models');
  m.FS.mount(m.FS.filesystems.NODEFS, { root: dirname(resolve(modelFile)) }, '/models');
  return new WasmMeasurer(m, `/models/${basename(modelFile)}`);
}
