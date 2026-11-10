// Runs the WebAssembly verifier off the page's main thread. The page sends the model file (a Blob,
// mounted without copying it through JavaScript) and a receipt's tokens; this answers with the
// activation masses of the canonical pass: the same build the brain measured the receipt with.
import { WasmMeasurer, type NeuralsWasm } from '../../brain/wasm.ts';

type Request = { model: Blob; prompt: number[]; reply: number[] };

let measurer: WasmMeasurer | null = null;

self.onmessage = async (e: MessageEvent<Request>) => {
  try {
    if (!measurer) {
      const url = `${self.location.origin}/wasm/neurals-wasm.js`;
      const factory = (await import(/* @vite-ignore */ url)).default as () => Promise<NeuralsWasm & { FS: any }>;
      const m = await factory();
      m.FS.mkdir('/models');
      m.FS.mount(m.FS.filesystems.WORKERFS, { blobs: [{ name: 'model.gguf', data: e.data.model }] }, '/models');
      self.postMessage({ stage: 'loading' });
      measurer = new WasmMeasurer(m, '/models/model.gguf');
    }
    self.postMessage({ stage: 'replaying' });
    const t = performance.now();
    const mass = measurer.measure(e.data.prompt, e.data.reply);
    self.postMessage({ stage: 'done', mass, seconds: (performance.now() - t) / 1000 });
  } catch (err) {
    self.postMessage({ stage: 'error', error: (err as Error).message });
  }
};
