// neurals-probe: runs the brain on one message and measures how much each part fired (SPEC §7).
//
//   neurals-probe -m model.gguf -p "prompt" [-n 64] [-t threads] [--replay 1,2,3]
//
// generate mode (default): applies the chat template, generates up to -n tokens greedily, one
//   token per decode, as the hosted brain would.
// replay mode (--replay): feeds the given reply tokens after the prompt in a single batch
//   (teacher-forced), as a verifier would, and measures the same positions.
//
// Measured positions are the ones that produced the reply: the last prompt position through the
// second-to-last reply position. For each, it adds up |activation|:
//   column k of layer l : the 256 MLP neurons [256k, 256k+256) at the input of blk.l.ffn_down
//   head h of layer l   : the 128 values of head h at the input of blk.l.attn_output
//   embedding           : the token embedding row fed in at that position
//   unembedding         : the final hidden state at the input of the output head
// Prints one JSON object: prompt and reply token ids, the reply text, and the masses in model order
// (embedding, then per layer 12 heads and 35 columns, then unembedding).

#include "llama.h"
#include "ggml.h"
#include "ggml-backend.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

static const int NEURONS_PER_COLUMN = 256;

struct Probe {
  int n_layer = 0, n_head = 0, head_dim = 0, ffn = 0, cols = 0;
  // Absolute position of row 0 of the batch being decoded, and the counted range [from, to].
  int base_pos = 0, count_from = 0, count_to = -1;
  double embedding = 0, unembedding = 0;
  std::vector<double> heads;   // n_layer * n_head
  std::vector<double> columns; // n_layer * cols
  std::vector<float> buf;
  std::string error;
};

// Reads a 2-D f32 tensor (ne0 values per row, ne1 rows) into p.buf, row-contiguous.
static bool read_rows(Probe & p, const ggml_tensor * t) {
  if (t->type != GGML_TYPE_F32) { p.error = std::string("not f32: ") + ggml_get_name(t); return false; }
  const int64_t ne0 = t->ne[0], ne1 = t->ne[1] * t->ne[2] * t->ne[3];
  p.buf.resize((size_t)(ne0 * ne1));
  const bool host = t->buffer == nullptr || ggml_backend_buffer_is_host(t->buffer);
  std::vector<uint8_t> tmp;
  const uint8_t * base;
  if (host) {
    base = (const uint8_t *)t->data;
  } else {
    tmp.resize(ggml_nbytes(t));
    ggml_backend_tensor_get(t, tmp.data(), 0, tmp.size());
    base = tmp.data();
  }
  for (int64_t r = 0; r < ne1; r++) {
    const int64_t i1 = r % t->ne[1], i2 = (r / t->ne[1]) % t->ne[2], i3 = r / (t->ne[1] * t->ne[2]);
    const uint8_t * row = base + i1 * t->nb[1] + i2 * t->nb[2] + i3 * t->nb[3];
    for (int64_t c = 0; c < ne0; c++) p.buf[(size_t)(r * ne0 + c)] = *(const float *)(row + c * t->nb[0]);
  }
  return true;
}

static int layer_of(const char * name, const char * suffix) {
  int l = -1;
  char rest[64];
  if (sscanf(name, "blk.%d.%63s", &l, rest) == 2 && strcmp(rest, suffix) == 0) return l;
  return -1;
}

static bool counted(const Probe & p, int64_t row) {
  const int64_t pos = p.base_pos + row;
  return pos >= p.count_from && pos <= p.count_to;
}

// What each callback is looking for. Returns 0 if the tensor is of no interest.
enum What { NONE, FFN_IN, ATTN_IN, OUT_IN, EMBD };

static What classify(const ggml_tensor * t, int * layer) {
  if (t->op == GGML_OP_MUL_MAT && t->src[0] && t->src[1]) {
    const char * w = ggml_get_name(t->src[0]);
    if ((*layer = layer_of(w, "ffn_down.weight")) >= 0) return FFN_IN;
    if ((*layer = layer_of(w, "attn_output.weight")) >= 0) return ATTN_IN;
    if (strcmp(w, "output.weight") == 0 || strcmp(w, "token_embd.weight") == 0) return OUT_IN; // tied output head
  }
  if (t->op == GGML_OP_GET_ROWS && t->src[0] && strcmp(ggml_get_name(t->src[0]), "token_embd.weight") == 0) return EMBD;
  return NONE;
}

static bool on_tensor(ggml_tensor * t, bool ask, void * user) {
  Probe & p = *(Probe *)user;
  int layer = -1;
  const What what = classify(t, &layer);
  if (ask) return what != NONE;
  if (what == NONE || !p.error.empty()) return true;

  const ggml_tensor * x = what == EMBD ? t : t->src[1];
  if (!read_rows(p, x)) return false;
  const int64_t ne0 = x->ne[0], rows = (int64_t)p.buf.size() / ne0;
  for (int64_t r = 0; r < rows; r++) {
    if (!counted(p, r)) continue;
    const float * v = &p.buf[(size_t)(r * ne0)];
    switch (what) {
      case FFN_IN:
        if (ne0 != p.ffn) { p.error = "unexpected FFN width"; return false; }
        for (int c = 0; c < p.cols; c++) {
          double s = 0;
          for (int k = 0; k < NEURONS_PER_COLUMN; k++) s += std::fabs((double)v[c * NEURONS_PER_COLUMN + k]);
          p.columns[(size_t)(layer * p.cols + c)] += s;
        }
        break;
      case ATTN_IN:
        if (ne0 != (int64_t)p.n_head * p.head_dim) { p.error = "unexpected attention width"; return false; }
        for (int h = 0; h < p.n_head; h++) {
          double s = 0;
          for (int k = 0; k < p.head_dim; k++) s += std::fabs((double)v[h * p.head_dim + k]);
          p.heads[(size_t)(layer * p.n_head + h)] += s;
        }
        break;
      case OUT_IN:
      case EMBD: {
        double s = 0;
        for (int64_t k = 0; k < ne0; k++) s += std::fabs((double)v[k]);
        (what == EMBD ? p.embedding : p.unembedding) += s;
        break;
      }
      default: break;
    }
  }
  return true;
}

static std::vector<llama_token> parse_ids(const char * s) {
  std::vector<llama_token> out;
  for (const char * c = s; *c;) {
    char * end;
    long v = strtol(c, &end, 10);
    if (end == c) break;
    out.push_back((llama_token)v);
    c = *end == ',' ? end + 1 : end;
  }
  return out;
}

static void json_string(const std::string & s) {
  putchar('"');
  for (unsigned char ch : s) {
    if (ch == '"' || ch == '\\') printf("\\%c", ch);
    else if (ch < 0x20) printf("\\u%04x", ch);
    else putchar(ch);
  }
  putchar('"');
}

static void ids_json(const std::vector<llama_token> & v) {
  putchar('[');
  for (size_t i = 0; i < v.size(); i++) printf(i ? ",%d" : "%d", v[i]);
  putchar(']');
}

int main(int argc, char ** argv) {
  const char * model_path = nullptr;
  std::string prompt;
  int n_gen = 64, threads = 4;
  const char * replay = nullptr;
  bool raw = false;
  for (int i = 1; i < argc; i++) {
    std::string a = argv[i];
    auto next = [&]() -> const char * { if (i + 1 >= argc) { fprintf(stderr, "missing value for %s\n", a.c_str()); exit(2); } return argv[++i]; };
    if (a == "-m") model_path = next();
    else if (a == "-p") prompt = next();
    else if (a == "-n") n_gen = atoi(next());
    else if (a == "-t") threads = atoi(next());
    else if (a == "--replay") replay = next();
    else if (a == "--raw") raw = true; // prompt is used as-is, without the chat template
    else { fprintf(stderr, "unknown argument %s\n", a.c_str()); return 2; }
  }
  if (!model_path || prompt.empty()) {
    fprintf(stderr, "usage: neurals-probe -m model.gguf -p prompt [-n 64] [-t 4] [--replay ids] [--raw]\n");
    return 2;
  }

  llama_log_set([](ggml_log_level level, const char * text, void *) { if (level >= GGML_LOG_LEVEL_ERROR) fputs(text, stderr); }, nullptr);
  llama_backend_init();
  llama_model_params mp = llama_model_default_params();
  mp.n_gpu_layers = 0;
  llama_model * model = llama_model_load_from_file(model_path, mp);
  if (!model) { fprintf(stderr, "cannot load %s\n", model_path); return 1; }
  const llama_vocab * vocab = llama_model_get_vocab(model);

  Probe p;
  p.n_layer = llama_model_n_layer(model);
  p.n_head = llama_model_n_head(model);
  p.head_dim = llama_model_n_embd(model) / p.n_head;
  p.ffn = 8960; // checked against the tensor on first use
  if (p.ffn % NEURONS_PER_COLUMN) { fprintf(stderr, "FFN width does not divide into columns\n"); return 1; }
  p.cols = p.ffn / NEURONS_PER_COLUMN;
  p.heads.assign((size_t)(p.n_layer * p.n_head), 0);
  p.columns.assign((size_t)(p.n_layer * p.cols), 0);

  // Prompt: one user turn with the model's own chat template.
  std::string text = prompt;
  if (!raw) {
    const char * tmpl = llama_model_chat_template(model, nullptr);
    llama_chat_message msg = { "user", prompt.c_str() };
    std::vector<char> out(prompt.size() * 2 + 4096);
    int n = llama_chat_apply_template(tmpl, &msg, 1, true, out.data(), (int32_t)out.size());
    if (n < 0) { fprintf(stderr, "chat template failed\n"); return 1; }
    if (n > (int)out.size()) { out.resize((size_t)n); n = llama_chat_apply_template(tmpl, &msg, 1, true, out.data(), (int32_t)out.size()); }
    text.assign(out.data(), (size_t)n);
  }
  std::vector<llama_token> prompt_ids(text.size() + 16);
  int np = llama_tokenize(vocab, text.c_str(), (int32_t)text.size(), prompt_ids.data(), (int32_t)prompt_ids.size(), true, true);
  if (np < 0) { fprintf(stderr, "tokenize failed\n"); return 1; }
  prompt_ids.resize((size_t)np);

  std::vector<llama_token> reply = replay ? parse_ids(replay) : std::vector<llama_token>();
  const int max_reply = replay ? (int)reply.size() : n_gen;
  const int n_ctx = np + max_reply + 8;

  llama_context_params cp = llama_context_default_params();
  cp.n_ctx = (uint32_t)n_ctx;
  cp.n_batch = (uint32_t)n_ctx; // one ubatch: rows map straight to positions
  cp.n_ubatch = (uint32_t)n_ctx;
  cp.n_threads = threads;
  cp.n_threads_batch = threads;
  cp.cb_eval = on_tensor;
  cp.cb_eval_user_data = &p;
  cp.no_perf = true;
  llama_context * ctx = llama_init_from_model(model, cp);
  if (!ctx) { fprintf(stderr, "cannot create context\n"); return 1; }

  // Every row asks for logits, so the last layer is never pruned to the final row only.
  auto decode = [&](const std::vector<llama_token> & toks, int pos0) -> bool {
    llama_batch b = llama_batch_init((int32_t)toks.size(), 0, 1);
    for (size_t i = 0; i < toks.size(); i++) {
      b.token[i] = toks[i];
      b.pos[i] = pos0 + (int)i;
      b.n_seq_id[i] = 1;
      b.seq_id[i][0] = 0;
      b.logits[i] = 1;
    }
    b.n_tokens = (int32_t)toks.size();
    p.base_pos = pos0;
    const int rc = llama_decode(ctx, b);
    llama_batch_free(b);
    if (rc != 0) { fprintf(stderr, "decode failed (%d)\n", rc); return false; }
    if (!p.error.empty()) { fprintf(stderr, "%s\n", p.error.c_str()); return false; }
    return true;
  };

  const int n_vocab = llama_vocab_n_tokens(vocab);
  auto argmax = [&](int row) {
    const float * l = llama_get_logits_ith(ctx, row);
    int best = 0;
    for (int i = 1; i < n_vocab; i++) if (l[i] > l[best]) best = i;
    return (llama_token)best;
  };

  if (replay) {
    // Positions np-1 .. np+R-2 produced the R reply tokens.
    p.count_from = np - 1;
    p.count_to = np + (int)reply.size() - 2;
    std::vector<llama_token> all = prompt_ids;
    all.insert(all.end(), reply.begin(), reply.end());
    if (!decode(all, 0)) return 1;
  } else {
    p.count_from = np - 1;
    p.count_to = np - 1;
    if (!decode(prompt_ids, 0)) return 1;
    llama_token tok = argmax(np - 1);
    for (int i = 0; i < n_gen; i++) {
      reply.push_back(tok);
      if (llama_vocab_is_eog(vocab, tok) || i == n_gen - 1) break;
      const int pos = np + i;
      p.count_from = p.count_to = pos;
      if (!decode({ tok }, pos)) return 1;
      tok = argmax(0);
    }
  }

  std::string reply_text;
  for (llama_token t : reply) {
    char piece[256];
    const int n = llama_token_to_piece(vocab, t, piece, sizeof piece, 0, false);
    if (n > 0) reply_text.append(piece, (size_t)n);
  }

  printf("{\"threads\":%d,\"mode\":\"%s\",\"prompt\":", threads, replay ? "replay" : "generate");
  ids_json(prompt_ids);
  printf(",\"output\":");
  ids_json(reply);
  printf(",\"text\":");
  json_string(reply_text);
  printf(",\"mass\":[%.17g", p.embedding);
  for (int l = 0; l < p.n_layer; l++) {
    for (int h = 0; h < p.n_head; h++) printf(",%.17g", p.heads[(size_t)(l * p.n_head + h)]);
    for (int c = 0; c < p.cols; c++) printf(",%.17g", p.columns[(size_t)(l * p.cols + c)]);
  }
  printf(",%.17g]}\n", p.unembedding);

  llama_free(ctx);
  llama_model_free(model);
  llama_backend_free();
  return 0;
}
