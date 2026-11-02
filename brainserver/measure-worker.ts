// Measures receipts off the brain server's main thread: the WebAssembly canonical pass takes several
// seconds and would otherwise block every other request. One worker, one message at a time.
import { parentPort, workerData } from 'node:worker_threads';
import { loadWasmInNode } from '../brain/wasm-node.ts';

const { wasm, model } = workerData as { wasm: string; model: string };
const measurer = await loadWasmInNode(wasm, model);
parentPort!.on('message', ({ id, prompt, reply }: { id: string; prompt: number[]; reply: number[] }) => {
  try {
    parentPort!.postMessage({ id, mass: measurer.measure(prompt, reply) });
  } catch (e) {
    parentPort!.postMessage({ id, error: (e as Error).message });
  }
});
parentPort!.postMessage({ ready: true });
