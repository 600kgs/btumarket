"""Georgian/Latin search folding.

The same word gets written in both scripts - a listing titled "მაკბუქი"
should be findable by searching "macbook" and vice versa. Exact
transliteration can't do this (one Latin spelling maps to several plausible
Georgian ones), so both scripts are folded onto a shared phonetic skeleton
and matched there:

    fold("მაკბუქი")  -> "makbuki"
    fold("macbook")  -> "makbuk"    (substring -> match)

The skeleton collapses distinctions people spell inconsistently: the
aspirated/ejective pairs (თ/ტ -> t, ქ/კ/ყ -> k, ფ/პ -> p), the sibilants
(ს/შ -> s, ც/წ/ჩ/ჭ -> c, ჟ/ჯ -> j), and the Latin digraphs used to type
them (sh, ch, ts, zh, kh, gh, dz). That loses precision but gains recall,
the right trade for a search box.

fold() is the canonical skeleton, stored per listing (listings.search_fold).
query_folds() generates the variants a query should match under: Latin input
is ambiguous in ways storage isn't ("c" is /k/ in "macbook" but ц-like in
"macivari"), so a few bounded alternatives get OR-ed into the SQL.
"""
from itertools import product

# Georgian folds unambiguously: one skeleton form per letter.
_GEORGIAN = {
    "ა": "a", "ბ": "b", "გ": "g", "დ": "d", "ე": "e", "ვ": "v", "ზ": "z",
    "თ": "t", "ი": "i", "კ": "k", "ლ": "l", "მ": "m", "ნ": "n", "ო": "o",
    "პ": "p", "ჟ": "j", "რ": "r", "ს": "s", "ტ": "t", "უ": "u", "ფ": "p",
    "ქ": "k", "ღ": "g", "ყ": "k", "შ": "s", "ჩ": "c", "ც": "c", "ძ": "z",
    "წ": "c", "ჭ": "c", "ხ": "x", "ჯ": "j", "ჰ": "h",
}

# Latin digraphs for Georgian sounds, plus English spellings that should
# land on the same skeleton (ph -> p, th -> t, oo -> u, ee -> i). Longest first.
_DIGRAPHS = [
    ("tch", "c"), ("sh", "s"), ("ch", "c"), ("ts", "c"), ("zh", "j"),
    ("kh", "x"), ("gh", "g"), ("dz", "z"), ("ph", "p"), ("th", "t"),
    ("oo", "u"), ("ee", "i"),
]

# Single letters with a canonical skeleton form. The ambiguous ones (c, w, y)
# get their most common reading here and alternatives in _QUERY_ALTERNATIVES.
_LATIN = {
    "f": "p", "q": "k",
    "c": "k",   # "macbook"; the ც reading is a query variant
    "w": "v",   # "wilson"; the წ reading is a query variant
    "y": "i",   # "sony"; the ყ reading is a query variant
}

_QUERY_ALTERNATIVES = {"c": ("k", "c"), "w": ("v", "c"), "y": ("i", "k")}


def _fold(text: str, overrides: dict | None = None) -> str:
    singles = {**_LATIN, **(overrides or {})}
    out = []
    text = text.lower()
    i = 0
    n = len(text)
    while i < n:
        matched = False
        for dg, repl in _DIGRAPHS:
            if text.startswith(dg, i):
                out.append(repl)
                i += len(dg)
                matched = True
                break
        if matched:
            continue
        ch = text[i]
        if ch in _GEORGIAN:
            out.append(_GEORGIAN[ch])
        elif ch in singles:
            out.append(singles[ch])
        elif ch.isalnum():
            out.append(ch)
        else:
            # punctuation/whitespace collapse to one space so word
            # boundaries survive
            out.append(" ")
        i += 1
    return " ".join("".join(out).split())


def fold(text: str) -> str:
    """Canonical skeleton, used for stored listing text."""
    return _fold(text)


def query_folds(q: str) -> list[str]:
    """Skeleton variants for a query, most likely first.

    Bounded: up to three ambiguous letters x two readings each, plus a
    trailing-ი stem (Georgian hangs a nominative -ი on loanwords: "მაკბუქი"
    folds to makbukI while a stored "MacBook" folds to makbuk), deduped and
    capped at 16.
    """
    q = q.strip()
    if not q:
        return []
    present = [ch for ch in _QUERY_ALTERNATIVES if ch in q.lower()]
    variants = []
    for combo in product(*(_QUERY_ALTERNATIVES[ch] for ch in present)):
        folded = _fold(q, dict(zip(present, combo)))
        for v in (folded, folded[:-1] if folded.endswith("i") else None):
            if v and len(v) >= 2 and v not in variants:
                variants.append(v)
    return variants[:16]
