"""Email polling and processing service"""
import imaplib
import email
from email.message import Message
import os
import tempfile
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import hashlib
import logging

from inbox.filter import html_to_text, is_candidate
from utils.crypto import decrypt_secret

logger = logging.getLogger(__name__)


class EmailService:
    """Service for connecting to and reading emails via IMAP"""

    def __init__(self, config):
        self.config = config
        self.imap = None

    def connect(self):
        """Connect to IMAP server"""
        try:
            if self.config.use_ssl:
                self.imap = imaplib.IMAP4_SSL(self.config.imap_server, self.config.imap_port)
            else:
                self.imap = imaplib.IMAP4(self.config.imap_server, self.config.imap_port)

            username = self.config.imap_username or self.config.email_address
            password = decrypt_secret(self.config.imap_password)
            self.imap.login(username, password)
            logger.info(f"Successfully connected to {self.config.imap_server}")
            return True
        except Exception as e:
            logger.error(f"IMAP connection failed: {e}")
            raise
    
    def disconnect(self):
        """Disconnect from IMAP server"""
        if self.imap:
            try:
                self.imap.logout()
                logger.info("Disconnected from IMAP server")
            except Exception as e:
                logger.error(f"Error disconnecting: {e}")
    
    def fetch_new_emails(self, since_date: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """Fetch emails since a date (read or not): invoice attachments, or bodies that look like money emails"""
        try:
            self.imap.select(self.config.folder_to_watch)

            search_criteria = 'ALL'
            if since_date:
                search_criteria = f'(SINCE {since_date.strftime("%d-%b-%Y")})'

            status, message_ids = self.imap.search(None, search_criteria)
            if status != 'OK':
                logger.warning(f"Search failed with status: {status}")
                return []

            email_ids = message_ids[0].split()
            logger.info(f"Found {len(email_ids)} emails since {since_date}")

            for email_id in email_ids:  # one message at a time, so a big backfill never sits in memory
                try:
                    email_data = self._fetch_email(email_id)
                    if email_data and (email_data['has_invoice_attachment']
                                       or is_candidate(email_data['subject'], email_data['text'], False)):
                        yield email_data
                except Exception as e:
                    logger.error(f"Error processing email {email_id}: {e}")

        except Exception as e:
            logger.error(f"Error fetching emails: {e}")

    def _fetch_email(self, email_id: bytes) -> Optional[Dict[str, Any]]:
        """Fetch one email: headers, body text and invoice attachments"""
        try:
            status, msg_data = self.imap.fetch(email_id, '(RFC822)')
            if status != 'OK':
                return None

            msg = email.message_from_bytes(msg_data[0][1])
            subject, sender, date = msg.get('Subject', ''), msg.get('From', ''), msg.get('Date', '')
            message_id = (msg.get('Message-ID') or '').strip() or hashlib.sha1(
                f"{sender}{date}{subject}".encode()).hexdigest()

            attachments, plain, html = [], None, None
            for part in msg.walk():
                if part.get_content_maintype() == 'multipart':
                    continue
                filename = part.get_filename()
                if filename and part.get_content_disposition() == 'attachment':  # inline logos aren't invoices
                    if self._is_invoice_attachment(filename):
                        attachments.append({'filename': filename, 'content': part.get_payload(decode=True)})
                    continue
                kind = part.get_content_type()
                if kind in ('text/plain', 'text/html'):
                    payload = part.get_payload(decode=True) or b''
                    body = payload.decode(part.get_content_charset() or 'utf-8', errors='replace')
                    if kind == 'text/plain' and plain is None:
                        plain = body
                    elif kind == 'text/html' and html is None:
                        html = body

            return {
                'id': email_id.decode(),
                'message_id': message_id,
                'subject': subject,
                'from': sender,
                'date': date,
                'text': plain if plain is not None else html_to_text(html or ''),
                'attachments': attachments,
                'has_invoice_attachment': bool(attachments),
            }

        except Exception as e:
            logger.error(f"Error fetching email: {e}")
            return None

    def _is_invoice_attachment(self, filename: str) -> bool:
        """Check if attachment is likely an invoice"""
        # Accept all common image and PDF formats
        valid_extensions = ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp', '.webp', '.gif']
        
        filename_lower = filename.lower()
        has_valid_ext = any(filename_lower.endswith(ext) for ext in valid_extensions)
        
        logger.debug(f"Checking {filename}: valid_ext={has_valid_ext}")
        return has_valid_ext
    
    def mark_as_read(self, email_id: str):
        """Mark email as read"""
        try:
            self.imap.store(email_id.encode(), '+FLAGS', '\\Seen')
            logger.debug(f"Marked email {email_id} as read")
        except Exception as e:
            logger.error(f"Error marking email as read: {e}")
