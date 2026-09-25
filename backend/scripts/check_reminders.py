"""
Check why reminders aren't being generated
"""
import sys
import os
from datetime import datetime, timedelta
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app
from ai.pattern_detection import PatternDetectionAgent
from models.database import db

def check_reminders():
    """Check reminder generation"""
    print("🔍 Checking Reminder Generation")
    print("=" * 60)

    with app.app_context():
        agent = PatternDetectionAgent()

        today = datetime.now().date()
        print(f"\nToday's Date: {today}")

        # Check patterns in database
        rows = db.session.execute(db.text("""
            SELECT vendor_name, next_predicted_date, confidence_score, pattern_type
            FROM spending_patterns
            WHERE user_id = :user_id
            ORDER BY next_predicted_date
        """), {'user_id': '123'}).mappings().all()

        print(f"\nTotal Patterns: {len(rows)}")
        print("\nPattern Dates:")
        for p in rows[:10]:
            vendor = p['vendor_name'] or 'N/A'
            next_date = datetime.fromisoformat(p['next_predicted_date']).date()
            days_until = (next_date - today).days
            print(f"  {vendor}: {next_date} ({days_until} days from now)")

        # Try different day ranges
        for days in [7, 14, 30, 60]:
            reminders = agent.generate_reminders(123, days_ahead=days)
            print(f"\nReminders with {days} days ahead: {len(reminders)}")
            if reminders:
                for r in reminders[:3]:
                    print(f"  • {r['title']} - {r['predicted_date']} ({r['days_until']} days)")

if __name__ == "__main__":
    check_reminders()
