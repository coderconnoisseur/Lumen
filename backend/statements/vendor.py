"""Turn a bank narration into a vendor name and a category (SPEC-STATEMENTS)."""
import re

_RAILS = {"upi", "pos", "neft", "imps", "rtgs", "ach", "nach", "p2a", "p2m", "payment"}
_SEPARATORS = re.compile(r"[\s/*\-]+")

# lowercase substrings, first matching category wins
_CATEGORIES = {
    "Subscriptions": ["netflix", "spotify", "prime video", "hotstar", "youtube", "apple.com/bill", "google *"],
    "Food": ["swiggy", "zomato", "restaurant", "cafe"],
    "Transport": ["uber", "ola", "rapido", "irctc", "metro", "fuel", "petrol"],
    "Shopping": ["amazon", "flipkart", "myntra", "ajio"],
    "Utilities": ["electricity", "power", "water", "gas", "broadband", "airtel", "jio", "vodafone"],
    "Groceries": ["bigbasket", "blinkit", "zepto", "dmart"],
    "Health": ["pharmacy", "apollo", "hospital"],
}


def _noise(token):
    digits = sum(c.isdigit() for c in token)
    return token.lower() in _RAILS or digits >= 4 or re.search(r"x{4,}", token, re.I)


def clean(description):
    """'UPI/NETFLIX.COM/9876543210/Payment' -> 'Netflix.com'."""
    tokens = [t for t in _SEPARATORS.split(description) if t and not _noise(t)]
    # keep dots ("Netflix.com"), which str.title() would capitalise
    return " ".join(t[0].upper() + t[1:].lower() for t in tokens) or description.strip()


def category(vendor_or_description):
    text = vendor_or_description.lower()
    for name, keywords in _CATEGORIES.items():
        if any(k in text for k in keywords):
            return name
    return "Other"
