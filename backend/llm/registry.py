"""Which models to try, per tier and role (llm/registry.yaml)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

import yaml

ROLES = ("text", "vision", "judge")
TIERS = ("openrouter", "groq", "ollama")
_DEFAULT_PATH = Path(__file__).with_name("registry.yaml")

# For openrouter only: the env vars that already existed before the registry.
_ENV_OVERRIDES = {
    "text": ("LLM_TEXT_MODEL", "LLM_TEXT_FALLBACK_MODELS"),
    "vision": ("LLM_VISION_MODEL", "LLM_VISION_FALLBACK_MODELS"),
}


class RegistryError(ValueError):
    pass


@dataclass(frozen=True)
class Entry:
    provider: str
    model: str
    family: str


def guess_family(model: str) -> str:
    """`vendor/name` -> vendor; `name:tag` -> name. Used when the registry doesn't say."""
    return model.split("/", 1)[0] if "/" in model else model.split(":", 1)[0]


class Registry:
    def __init__(self, data: dict):
        self._data = data or {}

    @classmethod
    def load(cls, path: Path | str | None = None) -> "Registry":
        with open(path or _DEFAULT_PATH, encoding="utf-8") as fh:
            return cls(yaml.safe_load(fh))

    def _own(self, tier: str, role: str, env: Mapping[str, str]) -> list[Entry]:
        if tier == "openrouter" and role in _ENV_OVERRIDES:
            primary_var, fallback_var = _ENV_OVERRIDES[role]
            primary = (env.get(primary_var) or "").strip()
            if primary:
                fallbacks = [m.strip() for m in (env.get(fallback_var) or "").split(",") if m.strip()]
                models = list(dict.fromkeys([primary, *fallbacks]))
                return [Entry(tier, m, guess_family(m)) for m in models]
        rows = ((self._data.get(tier) or {}).get(role)) or []
        # A row may name its own provider (e.g. the groq tier reads images with gemini: Groq has no vision model).
        return [Entry(row.get("provider") or tier, row["model"], row.get("family") or guess_family(row["model"]))
                for row in rows]

    def chain(self, tier: str, role: str, env: Mapping[str, str] | None = None) -> list[Entry]:
        """The tier's own models for `role`, then openrouter's as fallback."""
        if tier not in TIERS:
            raise RegistryError(f"unknown tier {tier!r}; expected one of {TIERS}")
        if role not in ROLES:
            raise RegistryError(f"unknown role {role!r}; expected one of {ROLES}")
        env = os.environ if env is None else env
        chain = self._own(tier, role, env)
        if tier != "openrouter":
            chain += self._own("openrouter", role, env)
        seen, unique = set(), []
        for entry in chain:
            if (entry.provider, entry.model) not in seen:
                seen.add((entry.provider, entry.model))
                unique.append(entry)
        return unique

    def check(self, tier: str, env: Mapping[str, str] | None = None) -> list[str]:
        """Raise on a judge that shares the text model's family; return warnings."""
        env = os.environ if env is None else env
        text = self.chain(tier, "text", env)
        judge = self.chain(tier, "judge", env)
        if text and judge and text[0].family == judge[0].family:
            raise RegistryError(
                f"judge {judge[0].model!r} shares family {judge[0].family!r} with text model "
                f"{text[0].model!r}; a model must not grade its own family"
            )
        warnings = []
        for role in ROLES:
            for entry in self.chain(tier, role, env):
                if entry.model == "openrouter/free":
                    warnings.append(
                        f"{role} chain for tier {tier!r} includes openrouter/free, which can route to "
                        f"models that reply empty or to a content-safety classifier"
                    )
        return warnings
