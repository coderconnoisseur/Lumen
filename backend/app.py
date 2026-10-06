"""LUMEN Financial Intelligence API - Main Application Entry Point"""
import logging
import os

from flask import Flask, jsonify
from flask_cors import CORS
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

from config import Config
from utils.logging_config import configure_logging, mask_secret
from utils.limiter import limiter
from utils.errors import api_error

configure_logging()
logger = logging.getLogger(__name__)

Config.validate()

from routes import register_routes
from utils.llm import check_api_key
from llm.client import registry as llm_registry, tier as llm_tier
from llm.deadline import install_flask as install_llm_deadline
from models.database import init_db
from utils.scheduler import scheduler

app = Flask(__name__)
app.config["SECRET_KEY"] = Config.SECRET_KEY
app.config["MAX_CONTENT_LENGTH"] = Config.MAX_UPLOAD_BYTES

CORS(
    app,
    origins=Config.ALLOWED_ORIGINS,
    supports_credentials=True,
)
logger.info("CORS allowlist: %s", Config.ALLOWED_ORIGINS)

limiter.init_app(app)
# Every request gets one time budget for all its LLM calls (llm/deadline.py).
install_llm_deadline(app)

init_db(app)
register_routes(app)

scheduler.app = app


@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(_e):
    return api_error("File too large", status=413, code="payload_too_large")


@app.errorhandler(HTTPException)
def handle_http_exception(e: HTTPException):
    return jsonify({"success": False, "error": e.description, "code": "http_error"}), e.code


@app.errorhandler(Exception)
def handle_unexpected_exception(e: Exception):
    return api_error("An internal error occurred", code="internal_error", log=e)


def startup_checks():
    """Once per server process: here under `python app.py`, and in asgi.py's lifespan under uvicorn."""
    for key in Config.SHADOWED_ENV_KEYS:
        logger.warning(
            "%s is set in your shell/system environment (%s) and overrides "
            "backend/.env. Remove it there if backend/.env should win.",
            key, mask_secret(os.environ.get(key)),
        )

    # Raises on a judge that shares the text model's family (SPEC-LLM);
    # warns about risky chains such as one containing openrouter/free.
    for warning in llm_registry().check(llm_tier()):
        logger.warning("LLM registry: %s", warning)
    from llm.providers import PROVIDERS

    ok, summary = check_api_key()
    tier, chains = llm_tier(), llm_registry()
    first = lambda role: next(iter(chains.chain(tier, role)), None)  # noqa: E731
    text_model, vision_model = first("text"), first("vision")
    (logger.info if ok else logger.error)(
        "%s Tier %s, key %s, text model %s, vision model %s",
        summary, tier, mask_secret(PROVIDERS[tier].api_key()),
        text_model.model if text_model else None, vision_model.model if vision_model else None,
    )


if __name__ == "__main__":
    # Werkzeug's debug reloader executes __main__ twice (watcher parent +
    # serving child). Do one-time startup work only in the serving process.
    serving_process = not Config.DEBUG or os.environ.get("WERKZEUG_RUN_MAIN") == "true"

    if serving_process:
        startup_checks()

    logger.info("Starting LUMEN Financial Intelligence API...")
    # Background polling too, otherwise two pollers race on the same inbox.
    if serving_process:
        scheduler.start()

    try:
        app.run(debug=Config.DEBUG, host=Config.HOST, port=Config.PORT)
    finally:
        scheduler.stop()
