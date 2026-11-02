// The receipt verifier for the browser: the probe's canonical pass compiled to WebAssembly.
// It includes neurals-probe.cpp itself, so a receipt is measured by exactly the same code as on
// the server. The page (a Web Worker) mounts the model file and calls:
//   neurals_load(path)                                  -> 0 when the model is loaded
//   neurals_measure(prompt, np, reply, nr, out_masses)  -> the number of masses written (1,318)
#define NEURALS_NO_MAIN
#include "neurals-probe.cpp"
#include <emscripten/emscripten.h>

static llama_model * g_model = nullptr;

extern "C" {

EMSCRIPTEN_KEEPALIVE int neurals_load(const char * path) {
  if (g_model) return 0;
  llama_log_set([](ggml_log_level level, const char * text, void *) { if (level >= GGML_LOG_LEVEL_ERROR) fputs(text, stderr); }, nullptr);
  llama_backend_init();
  llama_model_params mp = llama_model_default_params();
  mp.n_gpu_layers = 0;
  g_model = llama_model_load_from_file(path, mp);
  return g_model ? 0 : 1;
}

EMSCRIPTEN_KEEPALIVE int neurals_measure(const int32_t * prompt, int np, const int32_t * reply, int nr, double * out) {
  if (!g_model || np < 1 || nr < 1) return -1;
  const int n_vocab = llama_vocab_n_tokens(llama_model_get_vocab(g_model));
  std::vector<llama_token> p_ids(prompt, prompt + np), r_ids(reply, reply + nr);
  for (llama_token t : p_ids) if (t < 0 || t >= n_vocab) return -2;
  for (llama_token t : r_ids) if (t < 0 || t >= n_vocab) return -2;
  Probe p;
  if (!probe_init(p, g_model)) return -3;
  llama_context * ctx = canonical_pass(g_model, p_ids, r_ids, 1, &p);
  if (!ctx) return -4;
  llama_free(ctx);
  masses_in_order(p, out);
  return 2 + p.n_layer * (p.n_head + p.cols);
}

}
