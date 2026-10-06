# SPEC-RAG: hybrid retrieval with citations

Status: **APPROVED 2026-10-03** (owner answers below). Covers roadmap **RAG-01 … RAG-09**, builder finding
6b **#3**, and the retrieval-label contract from EVAL-02.

## Goal
Answer questions about unstructured documents (PO PDFs, contracts, policies, invoice text) with retrieved,
cited evidence, filtered to the asking user, on Render's free tier. Every stage must earn its place in an
ablation table: dense → + BM25/RRF → + rerank, measured as recall@5 and nDCG@10 on the dev split.

## Non-goals
- Query rewriting, multi-query, HyDE, GraphRAG, late-interaction models. Add one only if the ablation shows
  retrieval is the bottleneck.
- The agent loop that decides *when* to search (SPEC-AGENT). This spec delivers `search_documents` as a
  function, plus a plain "answer from documents" path for evals and the chat fallback.
- OCR quality (SPEC-EXTRACT). RAG indexes whatever text extraction produced.
- Hosted vector databases. Postgres already holds the data, so a second database adds cost and another
  tenant-isolation surface.

## Design, stage by stage

| Stage | Proposed choice | Why |
|---|---|---|
| **Store** | A `document_chunks` table in the app database. Postgres: a `pgvector` `vector(384)` column. SQLite (tests, local): embeddings as float32 bytes, searched in numpy. | One database, one tenant filter (`WHERE user_id = :uid` in SQL), and backups and migrations come free. Render Postgres and Supabase both support pgvector. Replaces Chroma, which was disabled in production anyway, and drops the `chromadb` dependency (big, and its on-disk format breaks between minor versions). |
| **Search mode** | Exact cosine search, no ANN index, until a user has more than ~50k chunks. | At our scale exact search takes milliseconds and gives identical results on Postgres and numpy, so evals and production agree. HNSW is a one-line migration later. |
| **Chunking** | Split along the document's own sections or headings first; long sections become ~350-token pieces with ~15% overlap. A chunk never spans two sections. Ids: `<doc id>#sNN` or `<doc id>#sNN-k`. Each chunk keeps `doc_id`, `doc_type`, `user_id`, `title`, `section`, `content_hash` and `embedding_model`. | Section-aligned chunks keep a clause together, give a clean citation target, and match EVAL-02's labels by construction (a `#sNN-k` piece counts as section `#sNN`). The content hash makes re-ingesting idempotent. |
| **Embeddings** | `fastembed` with `BAAI/bge-small-en-v1.5` (384 dims, ONNX, CPU), run in-process. | Free, local, no quota, small enough for 512 MB. The model id is stored per chunk, so changing models means a `reindex` instead of silently mixed vectors (6b #3). |
| **Keyword search** | BM25 (`bm25s`) built per user from their chunks, cached in memory, and rebuilt when that user's chunk version changes. The tokenizer keeps codes like `PO-U1-202605-06` and `CP-202606-U1N18` whole. | Exact identifiers are where dense search fails, and AP questions are full of them. Postgres full-text search isn't true BM25, and `pg_search` isn't on Render. A per-user index is fine up to tens of thousands of chunks (honest limit, written in the README). |
| **Fusion** | Reciprocal Rank Fusion, k = 60, top 50 from each retriever. | Merges two ranked lists without calibrating BM25 scores against cosine similarity. A standard, defensible default. |
| **Rerank** | Cross-encoder over the fused top 30 → top 5. Production: FlashRank (ONNX MiniLM, CPU, tens of MB). Ablation only, locally: `BAAI/bge-reranker-v2-m3`. | Reranking reads question and passage together, so it fixes "similar topic, wrong document". The heavy reranker doesn't fit 512 MB; the README will say which one produced which number. |
| **Tenant isolation** | The user filter lives inside the retriever (SQL `WHERE` for dense, per-user BM25 index), never in the prompt. | The same rule that keeps SQL safe. Measured by the safety suite's tenant cases and a retrieval-level leak test. |
| **Answering** | The prompt gets the top chunks with ids; the answer must cite `[chunk id]` for each claim. Abstain ("I couldn't find this in your documents") when nothing relevant was retrieved; the cut-off is tuned on dev only. | Citations make answers checkable and feed the UX "show sources" chips. Abstention is a measured outcome, not a failure. |
| **Embedding cassette** | Embeddings of the eval corpus and questions are cached in a committed file keyed by model id + text hash, like the LLM cassettes. | `pytest -m eval` must run offline in CI (no model download through the network block) and give identical numbers everywhere. |

## Interfaces (proposed)
```
backend/rag/
  chunking.py    # sections -> chunks (pure)
  embed.py       # Embedder protocol; FastEmbedder; CachedEmbedder (cassette); FakeEmbedder (tests)
  store.py       # ChunkStore: upsert(doc), delete(doc_id), dense_search(uid, vec, k) on pgvector or numpy
  bm25.py        # per-user BM25 cache with a version check
  retrieve.py    # search_documents(uid, query, *, mode="hybrid_rerank") -> [Hit(chunk_id, score, text, meta)]
  answer.py      # answer_from_documents(uid, question) -> {answer, citations, abstained}
  ingest.py      # PDF/text -> sections -> chunks -> embeddings -> store; `python -m rag.reindex`
```
- `mode` is `dense`, `hybrid` or `hybrid_rerank`, so the ablation runs the same code with one switch.
- **First real FastAPI routes** (under `backend/api/`, using API-01's auth, rate-limit and error parity):
  `POST /api/documents` (upload a PDF; ingest), `GET /api/documents`, `DELETE /api/documents/{id}`,
  `POST /api/documents/search` (debug and demo).
- Invoice uploads also index their extracted text as an "invoice card" chunk, so the agent can quote them.

## Evaluation (RAG-07, RAG-08)
- **Retrieval suite** (`evals/suites/retrieval.py`), no LLM calls: the 153 dev/test retrieval rows from
  EVAL-02 against the 20-document corpus, per mode. Metrics: recall@5, recall@10, MRR, nDCG@10, with counts
  and CIs. Output: the README ablation table.
- **Generation suite** (`evals/suites/generation.py`): the 36 generation rows. Faithfulness and citation
  precision judged by a different model family (SPEC-EVAL judge rule), abstention accuracy, and `must_not`
  checks on the other-tenant questions. Judge agreement against `judge_gold.jsonl`, which needs ~20 owner labels.
- **Safety:** the existing tenant and injection cases, plus injection text planted inside a corpus document.
  Hard gates stay at 0.
- **Ops:** per-stage latency (targets to confirm by measurement: retrieve < 150 ms, rerank < 300 ms) and process
  memory with fastembed + FlashRank loaded (must stay under ~450 MB for the 512 MB instance).

## Acceptance criteria
1. Re-ingesting a document changes nothing (content hashes); deleting a document removes its chunks from both
   indexes.
2. `search_documents` never returns another user's chunk, on Postgres or SQLite, in any mode (dedicated test).
3. Postgres (pgvector) and SQLite (numpy) give the same top-k for the same query (CI Postgres service).
4. The retrieval suite runs offline from the embedding cassette and is byte-identical across runs.
5. The ablation table (dense → + BM25/RRF → + rerank) is generated into the README, steps that didn't help
   included.
6. Answers cite chunk ids; every citation points to a retrieved chunk; unanswerable questions abstain.
7. Measured RSS with the production models loaded is under the budget, or the README says where RAG runs instead.
8. `ENABLE_CHROMA` and `chromadb` are gone; production config enables RAG (RAG-09) only after 1-7 pass.

## Build order inside this spec
RAG-01 chunking + store → RAG-02 embeddings + cassette → RAG-07a retrieval suite (dense baseline) → RAG-03/04
BM25 + RRF → RAG-05 rerank (+ memory check) → RAG-06 answering → RAG-07b generation suite → RAG-08 safety →
RAG-09 production switch. The ablation numbers come out of this order naturally: each step adds one row.

## Owner decisions (2026-10-03)
1. **Database:** local-first development (SQLite + local pgserver Postgres with pgvector). For deployment:
   backend on Render, **Postgres + pgvector on Supabase** (the free tier doesn't expire, unlike Render's 30-day
   free Postgres; 500 MB; auth already lives there). Put the Render service in the Supabase project's region,
   and connect through Supabase's IPv4 session pooler. Nothing in code or tests depends on either service.
2. **Documents page:** a minimal upload/list/delete page ships with RAG; UX polish comes later.
3. **Judge labels:** the owner labels ~20 answers when prompted.
4. **Abstention:** decided by the reranker's top score (local, no LLM credits), with the cut-off tuned on the
   dev split only; the answer prompt also tells the model to abstain when the evidence doesn't answer.
5. **Live deployments are assumed broken** unless the owner says otherwise; verification is local.
