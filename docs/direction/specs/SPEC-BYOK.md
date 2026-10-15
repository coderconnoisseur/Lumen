# SPEC-BYOK: users bring their own model keys

Status: **APPROVED (owner, 2026-10-14)**: providers OpenAI, Anthropic, Google Gemini, Groq, OpenRouter (listed models
only); during development the platform key is the owner's Groq key; new users get some free usage, then are asked to
add a key to keep using Lumen. Owner decision (2026-10-14): Lumen is bring-your-own-key. Users add their own
provider key; Lumen allows only a curated subset of providers and models, so reasoning is never weak because someone
picked an outdated model.

## Where we are
`backend/llm/` already routes every call through one client by **role** (`text`, `vision`, `judge`) and **tier**
(chains of models per provider in `llm/registry.yaml`), with Groq / Gemini / OpenRouter keys from server env vars,
shared by every visitor (free tiers). Retrieval models (embeddings, reranker) run locally (FastEmbed, FlashRank) and
need no key.

## Design
1. **Curated catalogue, not free choice.** A `byok` section in `llm/registry.yaml` lists, per provider, the models
   allowed for each role, best first. Users pick a **provider** and paste a key; Lumen picks the model per role from
   that provider's list (an "advanced" dropdown may choose among the listed models, never outside them). Updating the
   list is a one-line change; retired models drop off it.
   Proposed providers (decision for the owner): **OpenAI, Anthropic, Google Gemini, Groq, OpenRouter** (OpenRouter
   restricted to the listed model ids). Each must support tool calling and structured output for `text`, and images
   for `vision` (a provider without vision falls back to another key the user has, else the platform key).
2. **Roles keep their meaning:** `agent` (Ask Lumen; strongest tool-calling model on the list), `vision` (invoice
   reading), `text` (cheap structured jobs: email body parsing, categorising). A role can come from a different
   provider than the agent if the user adds two keys.
3. **Keys:** stored per user, encrypted (`utils/crypto.encrypt_secret`), never returned to the browser (only the last 4
   characters), validated on save with one cheap call (list models / a 1-token request), deletable. New table
   `user_keys(user_id, provider, key_enc, created_at, last_ok_at, last_error)`.
4. **Who pays when there's no key:** demo accounts and new users without a key use the **platform key** with today's
   limits (demo: 20 questions/day); the app shows "Add your key for unlimited use" when a limit is hit. ponytail:
   one shared platform quota; per-user platform quotas if abuse appears.
5. **Client change:** `llm.client.complete(...)` gets the user's credentials for the request (from a contextvar set by
   the auth layer) and builds the chain from the catalogue for that provider; platform env keys remain the fallback.
   Cassette replay keys on provider+model, so recorded evals are unaffected.
6. **Settings screen (bare bones):** provider list with "Add key", status (works / last error), remove; which model
   each role uses.

## Security
Keys are secrets at a trust boundary: encrypted at rest with a dedicated `EMAIL_ENCRYPTION_KEY`-style key
(`KEYS_ENCRYPTION_KEY`), never logged (mask to last 4), sent only to their provider, rate-limited validation.

## Testing
Catalogue loading and per-role picking; key save → encrypted at rest, masked on read, validated (provider mocked);
a request with a user key uses that provider/model; without a key falls back to the platform; a retired model id in
an old user setting is replaced by the current list's first; keys never appear in logs (caplog).

## Decisions (owner, 2026-10-14)
1. Providers as listed.
2. Keyless users (demo and new accounts) get a free allowance on the platform key, then a prompt to add their own key.
   The allowance size is a config value (start: the demo's 20 questions/day plus 20 invoice reads, total, per account).
