"""LLM-02: the bench runs a suite once per candidate, each alone in the chain, and writes a table."""


def test_each_candidate_runs_alone_in_the_chain(tmp_path):
    from evals import bench
    from llm import client

    seen = []

    def suite(t, split):
        chain = client.registry().chain(client.tier(), "text")  # how complete() looks it up
        seen.append([(e.provider, e.model) for e in chain])
        return {"metrics": {"execution_accuracy": {"passed": 3, "total": 4, "value": 0.75, "ci95": [0.3, 0.95]},
                            "ops": {"latency_s_recorded": {"p50": 1.0, "p95": 2.0}, "tokens_per_question_mean": 600}},
                "hard_gate_failures": []}

    report = bench.bench("groq", "sql", ["a/m1", "b/m2"], suites={"sql": suite})
    assert seen == [[("groq", "a/m1")], [("groq", "b/m2")]]  # no openrouter fallback
    doc = tmp_path / "LLM-BENCH.md"
    bench.write_doc(report, doc)
    bench.write_doc(report, doc)  # idempotent: the block is replaced, not appended
    text = doc.read_text(encoding="utf-8")
    assert text.count("<!-- bench:groq-sql:start -->") == 1
    assert "| `a/m1` | 3/4 (30%-95%)" in text and "1.0 s / 2.0 s" in text
