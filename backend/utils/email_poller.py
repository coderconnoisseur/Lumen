"""Background email polling service"""
import logging
import tempfile
import os
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from config import Config
from llm import keys
from inbox.filter import is_candidate
from inbox.gmail import GmailClient
from inbox.parse import parse_money_email
from inbox.save import already_processed, mark_processed, save_email_transaction
from models import EmailConfig, Receipt, ReviewItem, Transaction, User
from models.database import db
from utils.crypto import decrypt_secret
from utils.files import invoice_key, keep
from utils.email_service import EmailService
from utils.image_processing import image_to_base64, render_pdf_first_page, pil_image_to_bytes
from utils.llm import LLMError
from api.review import read_with_feedback, submit_invoice

logger = logging.getLogger(__name__)


def _email_day(header: str) -> str | None:
    try:
        return parsedate_to_datetime(header).date().isoformat()
    except (TypeError, ValueError):
        return None


def _readable(day) -> bool:
    try:
        date.fromisoformat((day or "")[:10])
        return True
    except ValueError:
        return False


def _key_problem(e: LLMError) -> str | None:
    """A failure only the user can fix (their key, or the free allowance): stop retrying until they do."""
    from llm.keys import PROVIDER_NAMES
    from utils.errors import KEY_MESSAGES

    if e.user_key:
        return KEY_MESSAGES["key_rejected"].format(provider=PROVIDER_NAMES.get(e.user_key, e.user_key))
    return KEY_MESSAGES["needs_key"] if e.kind == LLMError.NEEDS_KEY else None


_COUNT = {'imported': 'transactions_added', 'credit': 'credits', 'duplicate': 'duplicates', 'matched': 'duplicates'}


def process_user_emails(config: EmailConfig) -> dict:
    """Process emails for a single user"""
    service = None
    counts = dict(transactions_added=0, credits=0, duplicates=0, skipped=0)
    processed_count = 0
    error_count = 0

    try:
        logger.info(f"Starting email polling for {config.email_address}")
        service = (GmailClient(decrypt_secret(config.oauth_refresh_token)) if config.oauth_refresh_token
                   else EmailService(config))
        service.connect()

        user = db.session.get(User, config.user_id)
        default_currency = (user.currency if user else None) or Config.DEFAULT_CURRENCY

        # First run backfills 30 days, then everything since the last poll
        # SINCE is day-granular, so re-scan 2 days back; Message-ID dedup makes that safe
        since_date = (config.last_poll_time - timedelta(days=2) if config.last_poll_time
                      else datetime.utcnow() - timedelta(days=30))
        key_problem = None  # set when only the user can fix the failure: the poll stops and says why
        retry = False  # an email left for the next poll keeps last_poll_time where it was
        total = 0  # fetch_new_emails yields one message at a time
        for email_data in service.fetch_new_emails(since_date):
            total += 1
            message_id = email_data['message_id']
            committed = False
            if already_processed(db.session, config.user_id, message_id):
                continue

            if email_data['has_invoice_attachment']:
                llm_down = stop = False
                for attachment in email_data['attachments']:
                    try:
                        # saved by an earlier, partly failed pass over this email: don't submit it twice
                        key = invoice_key(str(config.user_id), attachment['content'],
                                          os.path.splitext(attachment['filename'])[1].lower().replace('.', ''))
                        if (db.session.query(Transaction.id).filter_by(user_id=config.user_id, file_key=key).first()
                                or db.session.query(ReviewItem.id).filter(
                                    ReviewItem.user_id == config.user_id,
                                    ReviewItem.invoice.contains(key, autoescape=True)).first()):
                            continue
                        result = process_invoice_attachment(
                            attachment['content'], attachment['filename'], config.user_id, email_data)
                        if result['success']:
                            processed_count += 1
                        else:
                            error_count += 1
                            logger.error(f"Failed to process invoice: {result.get('error', 'Unknown error')}")
                    except LLMError as e:
                        logger.warning(f"Invoice read unavailable ({e.kind}); will retry next poll")
                        llm_down = True
                        key_problem = _key_problem(e) or key_problem
                        stop = bool(e.user_key)  # a rejected key stops the poll; the allowance skips only this email
                        break
                    except Exception as e:
                        logger.error(f"Error processing attachment {attachment['filename']}: {e}")
                        error_count += 1
                if llm_down:  # provider outage: leave it unprocessed so the next poll retries
                    retry = True
                    if stop:
                        break
                    continue
            elif is_candidate(email_data['subject'], email_data['text'], False):
                try:
                    parsed = parse_money_email(email_data['subject'], email_data['from'], email_data['text'])
                except LLMError as e:
                    # provider outage: leave it unprocessed so the next poll retries
                    logger.warning(f"Email parse unavailable ({e.kind}); will retry next poll")
                    retry = True
                    key_problem = _key_problem(e) or key_problem
                    if e.user_key:  # a rejected key stops the poll; the allowance skips only this email
                        break
                    continue
                outcome = "skipped"
                if parsed is not None:
                    if not _readable(parsed.date):
                        parsed.date = _email_day(email_data['date'])
                    try:
                        outcome = save_email_transaction(
                            db.session, config.user_id, parsed, message_id, default_currency=default_currency)
                        mark_processed(db.session, config.user_id, message_id)
                        db.session.commit()
                    except Exception as e:
                        db.session.rollback()
                        logger.error(f"Saving one email failed ({type(e).__name__}); will retry next poll")
                        retry = True
                        continue
                    counts[_COUNT.get(outcome, 'skipped')] += 1
                    committed = True
                else:
                    counts['skipped'] += 1
            else:
                counts['skipped'] += 1

            if not committed:
                mark_processed(db.session, config.user_id, message_id)
                db.session.commit()

            if config.mark_as_read:
                try:
                    service.mark_as_read(email_data['id'])
                except Exception as e:
                    logger.error(f"Failed to mark email as read: {e}")

        # Update config status
        if not retry:
            config.last_poll_time = datetime.utcnow()
        config.last_successful_poll = datetime.utcnow()
        config.emails_processed = (config.emails_processed or 0) + processed_count + counts['transactions_added']
        config.last_error = key_problem
        db.session.commit()

        logger.info(f"Polling complete: {processed_count} invoices, {counts}, {error_count} errors")

        return {
            'success': True,
            'processed': processed_count,
            'errors': error_count,
            'total_emails': total,
            'emails_checked': total,
            'invoices_created': processed_count,
            **counts
        }

    except Exception as e:
        logger.error(f"Email polling failed for {config.email_address}: {e}")
        db.session.rollback()  # Rollback failed transaction
        try:
            config.last_error = str(e)  # last_poll_time stays: the next poll re-scans what this one missed
            db.session.commit()
        except Exception:
            db.session.rollback()
        return {
            'success': False,
            'error': str(e),
            'processed': processed_count,
            'errors': error_count,
            'emails_checked': 0,
            'invoices_created': processed_count,
            **counts
        }

    finally:
        if service:
            service.disconnect()


def process_invoice_attachment(content: bytes, filename: str, user_id: str, email_data: dict) -> dict:
    """Process a single invoice attachment"""
    try:
        file_ext = os.path.splitext(filename)[1].lower().replace('.', '')
        
        logger.info(f"Processing {file_ext} file: {filename}")
        
        # Determine media type
        media_type_map = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'bmp': 'image/bmp',
            'webp': 'image/webp',
            'pdf': 'application/pdf'
        }
        
        # Process based on file type
        if file_ext == 'pdf':
            # Convert PDF to images and process first page
            logger.info("Converting PDF to images...")
            first_page, _total_pages = render_pdf_first_page(content)
            
            if first_page is None:
                return {'success': False, 'error': 'No pages found in PDF', 'filename': filename}
            
            img_bytes = pil_image_to_bytes(first_page, format='PNG')
            image_base64 = image_to_base64(img_bytes)
            media_type = 'image/png'
            
            logger.info("Extracting data from PDF with AI...")
            structured_data = read_with_feedback(db.engine, str(user_id), image_base64, media_type)
            
        elif file_ext in media_type_map:
            # Process image directly
            logger.info(f"Extracting data from {file_ext} image with AI...")
            image_base64 = image_to_base64(content)
            media_type = media_type_map[file_ext]
            
            structured_data = read_with_feedback(db.engine, str(user_id), image_base64, media_type)
        else:
            return {
                'success': False,
                'error': f'Unsupported file format: {file_ext}',
                'filename': filename
            }
        
        # Add source metadata
        structured_data['source_file'] = filename
        structured_data['file_type'] = file_ext
        structured_data['source'] = 'email'
        structured_data['file_key'] = keep(invoice_key(str(user_id), content, file_ext), content)
        
        # Normalize the data
        logger.info("Normalizing transaction data...")
        normalized = structured_data
        
        # Checked like an upload (SPEC-EXTRACT): saved if nothing is doubtful, otherwise queued for review
        item = submit_invoice(db.engine, user_id, normalized)
        transaction_id = item["transaction_id"]

        if item["id"]:
            logger.info("Invoice %s from email: %s (transaction %s)", filename, item["status"], transaction_id)
            return {
                'success': True,
                'transaction_id': transaction_id,
                'review': {k: item[k] for k in ("id", "status", "confidence", "flags")},
                'filename': filename
            }
        else:
            return {
                'success': False,
                'error': 'Failed to save transaction to database',
                'filename': filename
            }
        
    except LLMError:
        raise  # the poller retries the email next poll
    except Exception as e:
        logger.error(f"Error processing invoice {filename}: {e}", exc_info=True)
        return {
            'success': False,
            'error': str(e),
            'filename': filename
        }


def poll_all_users():
    """Poll emails for all users with enabled configs"""
    configs = EmailConfig.query.filter_by(polling_enabled=True).all()
    user_count = len(configs)

    log_func = logger.debug if user_count == 0 else logger.info
    log_func("Starting polling cycle for all users...")
    log_func(f"Found {user_count} users with polling enabled")

    results = []
    for config in configs:
        if keys.failing(db.engine, config.user_id):
            logger.info(f"Skipping user {config.user_id}: user key needs attention")
            continue
        try:
            with keys.for_user(config.user_id, db.engine):
                result = process_user_emails(config)
            results.append({
                'user_id': config.user_id,
                'email': config.email_address,
                **result
            })
        except Exception as e:
            logger.error(f"Failed to poll for user {config.user_id}: {e}")
            results.append({
                'user_id': config.user_id,
                'email': config.email_address,
                'success': False,
                'error': str(e)
            })

    log_func(f"Polling cycle complete: {len(results)} users processed")
    return results
