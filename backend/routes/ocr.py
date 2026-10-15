"""OCR and invoice extraction routes"""
import logging

from flask import Blueprint, g, request, jsonify

from utils.auth import require_auth
from utils.errors import api_error, llm_api_error
from utils.limiter import limiter
from utils.llm import LLMError
from utils.upload_validation import validate_upload
from utils.image_processing import (
    ImageReadError,
    PDFReadError,
    image_to_base64,
    image_to_png,
    pil_image_to_bytes,
    render_pdf_first_page,
)
from api.review import read_with_feedback, submit_invoice
from models.database import db
from utils.files import invoice_key, keep

logger = logging.getLogger(__name__)
# Create blueprint
ocr_bp = Blueprint('ocr', __name__)

MEDIA_TYPES = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp',
}
# OpenRouter takes png/jpeg/webp/gif images. BMP isn't one of them, and an
# animated GIF would send every frame, so both go as a PNG of the first frame.
CONVERT_TO_PNG = frozenset({'bmp', 'gif'})

# What the user sees when the vision model fails (status codes: utils.errors.llm_api_error).
OCR_LLM_MESSAGES = {
    "rate_limited": "Invoice scanning is handling too many requests right now. Please try again in a minute.",
    "bad_response": "We couldn't read this invoice. Please try again, or upload a clearer image.",
    "unavailable": "Invoice scanning is unavailable right now. Please try again shortly.",
}


class UploadError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "bad_upload"):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


def read_uploaded_invoice(engine, user_id: str, filename: str, content: bytes) -> dict:
    """Validate, read (PDF page 1 / image) and keep an uploaded invoice. Shared by /extract and Ask Lumen."""
    upload_error = validate_upload(filename, content)
    if upload_error:
        raise UploadError(upload_error)

    file_ext = filename.lower().rsplit('.', 1)[-1]

    # OCR (PDFs: first page only)
    if file_ext == 'pdf':
        try:
            first_page, total_pages = render_pdf_first_page(content)
        except PDFReadError as e:
            logger.info("Unreadable PDF upload %r: %s", filename, e)
            raise UploadError("Couldn't open this PDF. It may be corrupted or password-protected.", 422, "pdf_unreadable")
        if first_page is None:
            raise UploadError("This PDF has no pages.", 422, "pdf_empty")

        image_base64 = image_to_base64(pil_image_to_bytes(first_page, format='PNG'))
        logger.info("Processing PDF page 1/%d with the vision model...", total_pages)
        structured_data = read_with_feedback(engine, user_id, image_base64, 'image/png')
        structured_data['pages_processed'] = 1
        structured_data['total_pages'] = total_pages
    elif file_ext in CONVERT_TO_PNG:
        try:
            png = image_to_png(content)
        except ImageReadError as e:
            logger.info("Unreadable %s upload %r: %s", file_ext, filename, e)
            raise UploadError("Couldn't open this image. It may be corrupted.", 422, "image_unreadable")
        logger.info("Processing %s image as PNG with the vision model...", file_ext)
        structured_data = read_with_feedback(engine, user_id, image_to_base64(png), 'image/png')
    elif file_ext in MEDIA_TYPES:
        logger.info("Processing %s image with the vision model...", file_ext)
        structured_data = read_with_feedback(engine, user_id, image_to_base64(content), MEDIA_TYPES[file_ext])
    else:
        raise UploadError('Unsupported file format. Please upload PDF or image file (JPG, PNG, GIF, BMP, WEBP).')

    structured_data['source_file'] = filename
    structured_data['file_type'] = file_ext

    # The reader already returns the fixed, validated structure (EXT-01); keep the original file
    structured_data['file_key'] = keep(invoice_key(user_id, content, file_ext), content)
    if structured_data["total_amount"] is None and not structured_data["vendor_name"]:
        logger.info("OCR found no invoice data in %r", filename)
        logger.debug("OCR reply for %r: %s", filename, structured_data)
        raise UploadError(
            "We couldn't find invoice details in this file. Please upload a clear photo or PDF of an invoice or receipt.",
            422, "no_invoice_data")
    return structured_data


@ocr_bp.route('/extract', methods=['POST'])
@limiter.limit("15 per minute")
@require_auth
def extract_invoice_data():
    """
    Combined endpoint: OCR image/PDF and store transaction directly to database.
    The transaction is saved under the authenticated user (g.user_id from JWT).
    """
    user_id = g.user_id

    # Validate file
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    # Steps 1-2: validate, OCR, keep the original
    try:
        normalized = read_uploaded_invoice(db.engine, str(user_id), file.filename, file.read())
    except UploadError as e:
        return api_error(e.message, status=e.status, code=e.code)
    except LLMError as e:
        return llm_api_error(e, OCR_LLM_MESSAGES, context=f"OCR failed for user={user_id}")
    except Exception as e:
        return api_error("Invoice extraction failed", code="extract_failed", log=e)
    structured_data = normalized

    # Step 3: Check (SPEC-EXTRACT): nothing doubtful -> saved as a transaction; otherwise it waits in the
    # review queue. If this fails the user must know: reporting success would lose the invoice silently.
    try:
        item = submit_invoice(db.engine, user_id, normalized, email=g.user_email)
    except Exception as e:
        return api_error(
            "We read the invoice but couldn't save it. Please try again.",
            code="save_failed",
            log=e,
        )

    rules = [f["rule"] for f in item["flags"]]
    if item["status"] == "approved":
        logger.info("Transaction %s saved for user %s", item["transaction_id"], user_id)
        message = 'Transaction extracted and stored successfully'
    else:
        message = 'Sent to review: ' + '; '.join(f["detail"] for f in item["flags"])

    return jsonify({
        'success': True,
        'duplicate': 'duplicate' in rules,
        'message': message,
        'transaction_id': item["transaction_id"],
        'review': {k: item[k] for k in ("id", "status", "confidence", "flags")},
        'data': normalized,
        'ocr_data': structured_data,
    }), 200
