// Loads the WebAssembly verifier (brain/wasm.ts) in Node, with the model's folder mounted (NODEFS).
import { dirname, basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WasmMeasurer, type NeuralsWasm } from './wasm.ts';

export async function loadWasmInNode(wasmJs: string, modelFile: string): Promise<WasmMeasurer> {
  const factory = (await import(pathToFileURL(resolve(wasmJs)).href)).default as () => Promise<NeuralsWasm & { FS: any }>;
  const m = await factory();
  m.FS.mkdir('/models');
  m.FS.mount(m.FS.filesystems.NODEFS, { root: dirname(resolve(modelFile)) }, '/models');
  return new WasmMeasurer(m, `/models/${basename(modelFile)}`);
}
