# 2026-10-04: retrieval ablation (dev split)

The retrieval suite (`backend/evals/suites/retrieval.py`) on EVAL-02's 104 dev retrieval questions over the
20-document corpus (12 purchase orders, 6 contracts, 2 policies; 2 users). Labels are by construction: each
fact is planted in exactly one section. The corpus PDFs go through the real ingest path. No LLM calls; the
embedding and reranker scores are local models, replayed from committed caches.

- Embeddings: `BAAI/bge-small-en-v1.5` (fastembed, ONNX, CPU), chunk text prefixed with title + heading.
- Keyword: per-user BM25 (`bm25s`); the tokenizer keeps codes like `PO-U1-202507-01` whole.
- Fusion: RRF, k = 60, top 50 from each retriever.
- Rerank: FlashRank cross-encoder over the fused top 15.

| Stage | recall@5 | recall@10 | MRR | nDCG@10 | Right section in top 5 (95% CI) |
|---|---|---|---|---|---|
| Dense only | 0.644 | 0.750 | 0.593 | 0.629 | 67/104 (0.55-0.73) |
| + BM25 via RRF | 0.788 | 0.923 | 0.578 | 0.660 | 82/104 (0.70-0.86) |
| + Rerank, MiniLM-L-12 (production) | **0.962** | **1.000** | **0.946** | **0.958** | **100/104** (0.91-0.98) |
| + Rerank, TinyBERT-L-2 (fast mode) | 0.923 | 1.000 | 0.774 | 0.827 | 96/104 (0.86-0.96) |

## What each stage fixed
- **Dense only:** contracts 37/37 and policies 14/14, but purchase orders 16/53. Twelve POs read alike to an
  embedding model; it found the "order total" section, but of the wrong PO.
- **+ BM25:** POs went to 31/53. The exact PO number is a rare token, so keyword search picks the right
  document. New failure: right PO, wrong section. MRR dipped slightly (0.593 → 0.578): the right section is in
  the list but often not first. Reported as is.
- **+ Rerank:** reading question and passage together fixed the section choice: 100/104 in the top 5.

## Latency and memory (laptop CPU, warm, p50)
| Stage | p50 |
|---|---|
| Embed query | 24 ms |
| Dense search (exact) | 5 ms |
| BM25 | 2 ms |
| Rerank 30 candidates, MiniLM-L-12 | 1,206 ms |
| Rerank 15 candidates, MiniLM-L-12 | 599 ms |
| Rerank 30 / 15 candidates, TinyBERT-L-2 | 43 / 22 ms |

- **Candidate count chosen on dev:** 15 gave the same hit@5 as 30 with a slightly better MRR, at half the
  latency; 10 dropped to 92/104.
- **Process memory** with both models loaded: ~128 MB, inside the 512 MB Render instance.
- **Open risk:** Render's free CPU is slower than this laptop. If reranking there exceeds the budget, the fast
  mode (TinyBERT) is the measured fallback: 96/104 at ~22 ms.
