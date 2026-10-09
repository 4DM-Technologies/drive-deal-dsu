import re
import unicodedata

BLOCKED_CHAT_TERMS = (
    "fuck",
    "shit",
    "bitch",
    "asshole",
    "bastard",
    "dick",
    "motherfucker",
    "bullshit",
    "piss",
)

_LEET_TRANSLATION = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"})


def violates_chat_guidelines(message: str) -> bool:
    """Detect common profanity, including simple leetspeak and punctuation obfuscation."""
    normalized = unicodedata.normalize("NFKC", message).casefold().translate(_LEET_TRANSLATION)
    words = re.findall(r"[a-z0-9]+", normalized)
    compact = re.sub(r"[^a-z0-9]", "", normalized)
    return any(word.startswith(term) for word in words for term in BLOCKED_CHAT_TERMS) or any(
        term in compact for term in BLOCKED_CHAT_TERMS
    )
