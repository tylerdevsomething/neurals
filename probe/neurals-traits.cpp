// neurals-traits: measures the brain's traits (SPEC §4) on the exact model file.
//
//   neurals-traits -m model.gguf -f reference.txt [-t 2] [-k 20] [--candidates 4] [--induction-len 64]
//
// Prints one JSON object with the raw measurements; tools/traits.ts applies the thresholds and caps
// and writes the rules draft. Passes (flash attention off, one batch each, fixed threads):
//   A. the reference text: per-head share of attention on the first token (Attention Sink);
//      per-neuron largest |activation| and its layer's median (Massive Activation); per-neuron
//      top-k positions and the token at each (Monosemantic); per-layer largest MLP input and
//      output (Super Weight candidates); the baseline perplexity.
//   B. random tokens repeated twice: per-head attention from each token of the second copy to the
//      token that followed its earlier copy (Induction Head).
//   C. per Super Weight candidate: the reference text again with that one weight's contribution
//      removed; the perplexity ratio against the baseline.

#include "llama.h"
#include "ggml.h"
#include "ggml-backend.h"
#include "ggml-cpu.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <queue>
#include <sstream>
#include <string>
#include <vector>

struct Cand { int layer = -1, neuron = -1, out = -1; float in_val = 0, out_val = 0, weight = 0; };

struct State {
  int n_layer = 0, n_head = 0, ffn = 0, n_embd = 0, k = 20;
  enum Mode { REFERENCE, INDUCTION, ABLATE } mode = REFERENCE;
  int ind_len = 0;            // pass B: length of the random sequence
  Cand ablate;                // pass C: the weight whose contribution is removed
  std::vector<llama_token> tokens;
  // pass A
  std::vector<double> sink, sink_n;                         // per head
  std::vector<float> max_abs;                               // per neuron (layer * ffn + j)
  std::vector<float> layer_median;                          // per layer
  std::vector<std::vector<std::pair<float, int>>> topk;     // per neuron: min-heap of (|x|, position)
  std::vector<Cand> cand;                                   // per layer: largest input and output
  // pass B
  std::vector<double> ind, ind_n;                           // per head
  std::vector<float> buf;
  std::string error;
};

static bool read_rows(State & s, const ggml_tensor * t) {
  if (t->type != GGML_TYPE_F32) { s.error = std::string("not f32: ") + ggml_get_name(t); return false; }
  const int64_t ne0 = t->ne[0], rows = t->ne[1] * t->ne[2] * t->ne[3];
  s.buf.resize((size_t)(ne0 * rows));
  std::vector<uint8_t> tmp;
  const uint8_t * base = (const uint8_t *)t->data;
  if (t->buffer && !ggml_backend_buffer_is_host(t->buffer)) {
    tmp.resize(ggml_nbytes(t));
    ggml_backend_tensor_get(t, tmp.data(), 0, tmp.size());
    base = tmp.data();
  }
  for (int64_t r = 0; r < rows; r++) {
    const int64_t i1 = r % t->ne[1], i2 = (r / t->ne[1]) % t->ne[2], i3 = r / (t->ne[1] * t->ne[2]);
    const uint8_t * row = base + i1 * t->nb[1] + i2 * t->nb[2] + i3 * t->nb[3];
    for (int64_t c = 0; c < ne0; c++) s.buf[(size_t)(r * ne0 + c)] = *(const float *)(row + c * t->nb[0]);
  }
  return true;
}

static int layer_of(const char * name, const char * suffix) {
  int l = -1;
  char rest[64];
  if (sscanf(name, "blk.%d.%63s", &l, rest) == 2 && strcmp(rest, suffix) == 0) return l;
  return -1;
}

/** One element W[out][in] of a weight matrix stored as rows of ne0 = in values (quantized or not). */
static float weight_at(const ggml_tensor * w, int out, int in) {
  std::vector<float> row((size_t)w->ne[0]);
  const char * src = (const char *)w->data + (size_t)out * w->nb[1];
  std::vector<uint8_t> tmp;
  if (w->buffer && !ggml_backend_buffer_is_host(w->buffer)) {
    tmp.resize(w->nb[1]);
    ggml_backend_tensor_get(w, tmp.data(), (size_t)out * w->nb[1], w->nb[1]);
    src = (const char *)tmp.data();
  }
  if (w->type == GGML_TYPE_F32) return ((const float *)src)[in];
  const auto * traits = ggml_get_type_traits(w->type);
  if (!traits || !traits->to_float) return NAN;
  traits->to_float(src, row.data(), w->ne[0]);
  return row[(size_t)in];
}

static bool on_tensor(ggml_tensor * t, bool ask, void * user) {
  State & s = *(State *)user;
  if (!s.error.empty()) return !ask;
  const char * name = ggml_get_name(t);
  int layer = -1;
  const bool ffn = t->op == GGML_OP_MUL_MAT && t->src[0] && (layer = layer_of(ggml_get_name(t->src[0]), "ffn_down.weight")) >= 0;
  int sm_layer = -1;
  const bool softmax = t->op == GGML_OP_SOFT_MAX && sscanf(name, "kq_soft_max-%d", &sm_layer) == 1;
  if (ask) return ffn || softmax;
  if (!ffn && !softmax) return true;
  static const bool debug = getenv("NEURALS_DEBUG") != nullptr;
  if (debug) fprintf(stderr, "[traits] %s %s layer %d ne %lld %lld %lld\n", softmax ? "softmax" : "ffn", name, softmax ? sm_layer : layer, (long long)t->ne[0], (long long)t->ne[1], (long long)t->ne[2]);

  if (softmax) {
    if (s.mode == State::ABLATE) return true;
    if (!read_rows(s, t)) return false;
    const int64_t n_kv = t->ne[0], n_q = t->ne[1], heads = t->ne[2];
    if (heads != s.n_head) { s.error = "unexpected attention shape"; return false; }
    for (int64_t h = 0; h < heads; h++) {
      const size_t hi = (size_t)(sm_layer * s.n_head + h);
      for (int64_t q = 0; q < n_q; q++) {
        const float * p = &s.buf[(size_t)((h * n_q + q) * n_kv)];
        if (s.mode == State::REFERENCE && q >= 1) { s.sink[hi] += p[0]; s.sink_n[hi] += 1; }
        if (s.mode == State::INDUCTION && q >= s.ind_len && q < 2 * s.ind_len - 1) {
          s.ind[hi] += p[q - s.ind_len + 1];
          s.ind_n[hi] += 1;
        }
      }
    }
    return true;
  }

  // The FFN down-projection: input = MLP neuron activations, output = the layer's MLP contribution.
  const ggml_tensor * x = t->src[1];
  if (s.mode == State::ABLATE) {
    if (layer != s.ablate.layer) return true;
    // Remove W[out][neuron] * x[neuron] from the output at `out`, for every token: the same as
    // setting that one weight to zero.
    if (!read_rows(s, x)) return false;
    std::vector<float> xin = s.buf;
    float * out = (float *)t->data;
    if (t->buffer && !ggml_backend_buffer_is_host(t->buffer)) { s.error = "output not in host memory"; return false; }
    for (int64_t r = 0; r < x->ne[1]; r++) {
      float * row = (float *)((char *)out + r * t->nb[1]);
      row[s.ablate.out] -= s.ablate.weight * xin[(size_t)(r * x->ne[0] + s.ablate.neuron)];
    }
    return true;
  }
  if (s.mode != State::REFERENCE) return true;
  if (!read_rows(s, x)) return false;
  const int64_t n = x->ne[0], rows = x->ne[1];
  if (n != s.ffn) { s.error = "unexpected FFN width"; return false; }
  Cand & c = s.cand[(size_t)layer];
  c.layer = layer;
  std::vector<float> all;
  all.reserve((size_t)(n * rows));
  for (int64_t r = 0; r < rows; r++) {
    for (int64_t j = 0; j < n; j++) {
      const float v = std::fabs(s.buf[(size_t)(r * n + j)]);
      all.push_back(v);
      const size_t ni = (size_t)(layer * s.ffn + j);
      if (v > s.max_abs[ni]) s.max_abs[ni] = v;
      if (v > c.in_val) { c.in_val = v; c.neuron = (int)j; }
      auto & heap = s.topk[ni];
      if ((int)heap.size() < s.k) { heap.push_back({v, (int)r}); std::push_heap(heap.begin(), heap.end(), std::greater<>()); }
      else if (v > heap.front().first) {
        std::pop_heap(heap.begin(), heap.end(), std::greater<>());
        heap.back() = {v, (int)r};
        std::push_heap(heap.begin(), heap.end(), std::greater<>());
      }
    }
  }
  std::nth_element(all.begin(), all.begin() + all.size() / 2, all.end());
  s.layer_median[(size_t)layer] = all[all.size() / 2];
  // The largest output value of the layer's MLP, and where it is.
  const ggml_tensor * o = t;
  std::vector<float> keep = s.buf;
  if (!read_rows(s, o)) return false;
  for (int64_t r = 0; r < o->ne[1]; r++) for (int64_t d = 0; d < o->ne[0]; d++) {
    const float v = std::fabs(s.buf[(size_t)(r * o->ne[0] + d)]);
    if (v > c.out_val) { c.out_val = v; c.out = (int)d; }
  }
  s.buf.swap(keep);
  if (debug) fprintf(stderr, "[traits] weight_at type %s out %d neuron %d buffer %s\n", ggml_type_name(t->src[0]->type), c.out, c.neuron, t->src[0]->buffer ? ggml_backend_buffer_name(t->src[0]->buffer) : "none");
  c.weight = weight_at(t->src[0], c.out, c.neuron);
  if (debug) fprintf(stderr, "[traits] weight %g\n", c.weight);
  return true;
}

static double perplexity(llama_context * ctx, const std::vector<llama_token> & toks, int n_vocab) {
  double nll = 0;
  for (size_t i = 0; i + 1 < toks.size(); i++) {
    const float * l = llama_get_logits_ith(ctx, (int32_t)i);
    float mx = l[0];
    for (int v = 1; v < n_vocab; v++) mx = std::max(mx, l[v]);
    double sum = 0;
    for (int v = 0; v < n_vocab; v++) sum += std::exp((double)l[v] - mx);
    nll += -((double)l[toks[i + 1]] - mx - std::log(sum));
  }
  return std::exp(nll / (double)(toks.size() - 1));
}

int main(int argc, char ** argv) {
  const char * model_path = nullptr;
  const char * ref_path = nullptr;
  int threads = 2, k = 20, n_cand = 4, ind_len = 64;
  for (int i = 1; i < argc; i++) {
    std::string a = argv[i];
    auto next = [&]() -> const char * { if (i + 1 >= argc) { fprintf(stderr, "missing value for %s\n", a.c_str()); exit(2); } return argv[++i]; };
    if (a == "-m") model_path = next();
    else if (a == "-f") ref_path = next();
    else if (a == "-t") threads = atoi(next());
    else if (a == "-k") k = atoi(next());
    else if (a == "--candidates") n_cand = atoi(next());
    else if (a == "--induction-len") ind_len = atoi(next());
    else { fprintf(stderr, "unknown argument %s\n", a.c_str()); return 2; }
  }
  if (!model_path || !ref_path) { fprintf(stderr, "usage: neurals-traits -m model.gguf -f reference.txt [-t 2] [-k 20]\n"); return 2; }
  std::ifstream in(ref_path, std::ios::binary);
  std::stringstream ss;
  ss << in.rdbuf();
  const std::string text = ss.str();
  if (text.empty()) { fprintf(stderr, "empty reference text\n"); return 1; }

  llama_log_set([](ggml_log_level level, const char * t, void *) { if (level >= GGML_LOG_LEVEL_ERROR) fputs(t, stderr); }, nullptr);
  llama_backend_init();
  llama_model_params mp = llama_model_default_params();
  mp.n_gpu_layers = 0;
  // No runtime repacking: weights stay in the file's layout, so one weight can be read back exactly.
  mp.use_extra_bufts = false;
  llama_model * model = llama_model_load_from_file(model_path, mp);
  if (!model) { fprintf(stderr, "cannot load %s\n", model_path); return 1; }
  const llama_vocab * vocab = llama_model_get_vocab(model);
  const int n_vocab = llama_vocab_n_tokens(vocab);

  State s;
  s.k = k;
  s.n_layer = llama_model_n_layer(model);
  s.n_head = llama_model_n_head(model);
  s.n_embd = llama_model_n_embd(model);
  s.ffn = 8960;
  s.sink.assign((size_t)(s.n_layer * s.n_head), 0);
  s.sink_n = s.sink;
  s.ind = s.sink;
  s.ind_n = s.sink;
  s.max_abs.assign((size_t)(s.n_layer * s.ffn), 0);
  s.layer_median.assign((size_t)s.n_layer, 0);
  s.topk.resize((size_t)(s.n_layer * s.ffn));
  s.cand.resize((size_t)s.n_layer);

  std::vector<llama_token> ref(text.size() + 16);
  int n_ref = llama_tokenize(vocab, text.c_str(), (int32_t)text.size(), ref.data(), (int32_t)ref.size(), true, false);
  if (n_ref < 2) { fprintf(stderr, "tokenize failed\n"); return 1; }
  ref.resize((size_t)n_ref);

  // Pass B's sequence: random tokens (a fixed generator, so every run measures the same thing),
  // repeated twice.
  std::vector<llama_token> rnd;
  uint64_t x = 0x9e3779b97f4a7c15ull;
  for (int i = 0; i < ind_len; i++) {
    x ^= x << 13; x ^= x >> 7; x ^= x << 17;
    rnd.push_back((llama_token)(1000 + x % 30000));
  }
  std::vector<llama_token> ind_seq = rnd;
  ind_seq.insert(ind_seq.end(), rnd.begin(), rnd.end());

  auto run = [&](const std::vector<llama_token> & toks) -> llama_context * {
    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = (uint32_t)(toks.size() + 8);
    cp.n_batch = cp.n_ctx;
    cp.n_ubatch = cp.n_ctx;
    cp.n_threads = threads;
    cp.n_threads_batch = threads;
    cp.cb_eval = on_tensor;
    cp.cb_eval_user_data = &s;
    cp.no_perf = true;
    cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;
    llama_context * ctx = llama_init_from_model(model, cp);
    if (!ctx) return nullptr;
    llama_batch b = llama_batch_init((int32_t)toks.size(), 0, 1);
    for (size_t i = 0; i < toks.size(); i++) {
      b.token[i] = toks[i]; b.pos[i] = (int)i; b.n_seq_id[i] = 1; b.seq_id[i][0] = 0; b.logits[i] = 1;
    }
    b.n_tokens = (int32_t)toks.size();
    const int rc = llama_decode(ctx, b);
    llama_batch_free(b);
    if (rc != 0 || !s.error.empty()) { fprintf(stderr, "decode failed: %d %s\n", rc, s.error.c_str()); llama_free(ctx); return nullptr; }
    return ctx;
  };

  s.mode = State::REFERENCE;
  llama_context * ctx = run(ref);
  if (!ctx) return 1;
  const double base_ppl = perplexity(ctx, ref, n_vocab);
  llama_free(ctx);
  fprintf(stderr, "pass A done: %d tokens, perplexity %.3f\n", n_ref, base_ppl);

  s.mode = State::INDUCTION;
  s.ind_len = ind_len;
  ctx = run(ind_seq);
  if (!ctx) return 1;
  llama_free(ctx);
  fprintf(stderr, "pass B done\n");

  // Super Weight candidates: the layers with the largest MLP output spikes.
  std::vector<Cand> cands = s.cand;
  std::sort(cands.begin(), cands.end(), [](const Cand & a, const Cand & b) { return a.out_val > b.out_val; });
  cands.resize((size_t)std::min<int>(n_cand, (int)cands.size()));
  std::vector<double> ratios;
  for (const Cand & c : cands) {
    s.mode = State::ABLATE;
    s.ablate = c;
    ctx = run(ref);
    if (!ctx) return 1;
    ratios.push_back(perplexity(ctx, ref, n_vocab) / base_ppl);
    llama_free(ctx);
    fprintf(stderr, "pass C: layer %d neuron %d -> x%.2f\n", c.layer, c.neuron, ratios.back());
  }

  // Output.
  printf("{\"tokens\":%d,\"k\":%d,\"perplexity\":%.6f,\"heads\":[", n_ref, k, base_ppl);
  for (int l = 0; l < s.n_layer; l++) for (int h = 0; h < s.n_head; h++) {
    const size_t i = (size_t)(l * s.n_head + h);
    printf("%s{\"layer\":%d,\"head\":%d,\"sink\":%.6f,\"induction\":%.6f}", i ? "," : "", l, h,
           s.sink_n[i] ? s.sink[i] / s.sink_n[i] : 0.0, s.ind_n[i] ? s.ind[i] / s.ind_n[i] : 0.0);
  }
  printf("],\"superWeight\":[");
  for (size_t i = 0; i < cands.size(); i++) {
    const Cand & c = cands[i];
    printf("%s{\"layer\":%d,\"neuron\":%d,\"out\":%d,\"weight\":%.6g,\"input\":%.6g,\"output\":%.6g,\"perplexityRatio\":%.6f}",
           i ? "," : "", c.layer, c.neuron, c.out, c.weight, c.in_val, c.out_val, ratios[i]);
  }
  printf("],\"neurons\":[");
  // Every neuron: largest |activation| relative to its layer's median, and how many of its top-k
  // positions hold the same token.
  bool first = true;
  for (int l = 0; l < s.n_layer; l++) for (int j = 0; j < s.ffn; j++) {
    const size_t ni = (size_t)(l * s.ffn + j);
    const auto & heap = s.topk[ni];
    int best_tok = -1, best = 0;
    std::vector<int> toks;
    for (const auto & e : heap) toks.push_back(ref[(size_t)e.second]);
    std::sort(toks.begin(), toks.end());
    for (size_t a = 0; a < toks.size();) {
      size_t b = a;
      while (b < toks.size() && toks[b] == toks[a]) b++;
      if ((int)(b - a) > best) { best = (int)(b - a); best_tok = toks[a]; }
      a = b;
    }
    const float ratio = s.layer_median[(size_t)l] > 0 ? s.max_abs[ni] / s.layer_median[(size_t)l] : 0;
    // Only neurons worth a look, to keep the output small.
    if (ratio < 50 && best * 10 < (int)heap.size() * 5) continue;
    // How often that token occurs in the whole text: a neuron that fires on a token found
    // everywhere is not selective, however consistent it is.
    int freq = 0;
    for (llama_token tk : ref) freq += tk == best_tok;
    printf("%s{\"layer\":%d,\"neuron\":%d,\"ratio\":%.3f,\"same\":%d,\"token\":%d,\"freq\":%d}", first ? "" : ",", l, j, ratio, best, best_tok, freq);
    first = false;
  }
  printf("]}\n");
  llama_model_free(model);
  llama_backend_free();
  return 0;
}
