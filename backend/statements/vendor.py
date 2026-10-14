"""Turn a bank narration into a vendor name and a category (SPEC-STATEMENTS)."""
import re

_RAILS = {"upi", "pos", "neft", "imps", "rtgs", "ach", "nach", "p2a", "p2m", "payment"}
_SEPARATORS = re.compile(r"[\s/*\-]+")

# whole words/phrases on the lowercased text; first matching category wins, so specific entries go first
_CATEGORIES = {
    "Subscriptions": ["netflix", "spotify", "prime video", "amazon prime", "hotstar", "youtube", "google play",
                      "apple.com"],
    "Food": ["uber eats", "swiggy", "zomato", "restaurant", "cafe"],
    "Groceries": ["jiomart", "metro cash", "bigbasket", "blinkit", "zepto", "dmart"],
    "Transport": ["uber", "ola", "rapido", "irctc", "metro", "fuel", "petrol", "indian oil", "hpcl", "bpcl"],
    "Shopping": ["amazon", "flipkart", "myntra", "ajio"],
    "Utilities": ["electricity", "power", "water", "gas", "broadband", "airtel", "jio", "vodafone"],
    "Health": ["pharmacy", "apollo", "hospital"],
}
_PATTERNS = {name: re.compile(r"\b(?:" + "|".join(re.escape(k) for k in kws) + r")\b")
             for name, kws in _CATEGORIES.items()}


def _noise(token):
    digits = sum(c.isdigit() for c in token)
    return token.lower() in _RAILS or digits >= 4 or "@" in token or re.search(r"x{4,}", token, re.I)


def clean(description):
    """'UPI/NETFLIX.COM/9876543210/Payment' -> 'Netflix.com'."""
    tokens = [t for t in _SEPARATORS.split(description) if t and not _noise(t)]
    # keep dots ("Netflix.com"), which str.title() would capitalise
    return " ".join(t[0].upper() + t[1:].lower() for t in tokens) or description.strip()


def category(vendor_or_description):
    text = " ".join(_SEPARATORS.split(vendor_or_description.lower()))
    for name, pattern in _PATTERNS.items():
        if pattern.search(text):
            return name
    return "Other"
