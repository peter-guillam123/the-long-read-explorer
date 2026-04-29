#!/usr/bin/env python3
"""
Fetch all Guardian Long Read articles and Audio Long Read episodes,
then match audio versions to their written counterparts.
"""

import json
import os
import re
import sys
import time
from html.parser import HTMLParser
from pathlib import Path

import requests

BASE_DIR = Path(__file__).parent.parent
RAW_DIR = BASE_DIR / "data" / "raw" / "articles"

# Load .env
env_path = BASE_DIR / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, val = line.split("=", 1)
            os.environ[key.strip()] = val.strip()

API_BASE = "https://content.guardianapis.com/search"
API_KEY = os.environ.get("GUARDIAN_API_KEY", "")

LONG_READ_TAG = "news/series/the-long-read"
AUDIO_LONG_READ_TAG = "news/series/the-audio-long-read"

RATE_LIMIT = 0.1  # seconds between requests


class HTMLStripper(HTMLParser):
    """Simple HTML tag stripper."""

    def __init__(self):
        super().__init__()
        self.result = []

    def handle_data(self, data):
        self.result.append(data)

    def get_text(self):
        return "".join(self.result)


def strip_html(html_text):
    """Remove HTML tags and return plain text."""
    if not html_text:
        return ""
    stripper = HTMLStripper()
    stripper.feed(html_text)
    text = stripper.get_text()
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def sanitize_id(guardian_id):
    """Convert Guardian content ID to a filesystem-safe filename."""
    return guardian_id.replace("/", "-")


def fetch_series(tag, label="articles"):
    """Fetch all items for a given series tag from the Guardian API."""
    items = []
    page = 1

    while True:
        params = {
            "tag": tag,
            "show-fields": "headline,standfirst,body,byline,wordcount,shortUrl",
            "show-tags": "all",
            "page-size": 200,
            "page": page,
            "order-by": "oldest",
            "api-key": API_KEY,
        }

        resp = requests.get(API_BASE, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()["response"]

        results = data.get("results", [])
        items.extend(results)

        total_pages = data.get("pages", 1)
        print(f"  Page {page}/{total_pages} — {len(results)} {label}")

        if page >= total_pages:
            break

        page += 1
        time.sleep(RATE_LIMIT)

    return items


def parse_article(item):
    """Parse a Guardian API result into our article format."""
    fields = item.get("fields", {})
    tags = [t.get("id", "") for t in item.get("tags", [])]

    body_html = fields.get("body", "")
    body_text = strip_html(body_html)

    return {
        "id": sanitize_id(item.get("id", "")),
        "guardian_id": item.get("id", ""),
        "title": fields.get("headline", item.get("webTitle", "")),
        "date": item.get("webPublicationDate", "")[:10],
        "author": fields.get("byline", ""),
        "standfirst": strip_html(fields.get("standfirst", "")),
        "body_text": body_text,
        "word_count": int(fields.get("wordcount", 0) or 0),
        "article_url": item.get("webUrl", ""),
        "audio_url": None,
        "has_audio": False,
        "tags": tags,
        "section": item.get("sectionId", ""),
    }


def normalize_title(title):
    """Normalize title for matching: lowercase, strip prefixes, remove punctuation."""
    title = title.lower().strip()
    # Remove common audio-specific prefixes
    for prefix in [
        "the audio long read: ",
        "audio long read: ",
        "the audio long read – ",
        "audio long read – ",
        "from the archive: ",
    ]:
        if title.startswith(prefix):
            title = title[len(prefix):]
    # Remove common suffixes
    for suffix in [" – podcast", " - podcast", " podcast"]:
        if title.endswith(suffix):
            title = title[:-len(suffix)]
    # Remove punctuation
    title = re.sub(r"[^\w\s]", "", title)
    return title.strip()


def title_similarity(t1, t2):
    """Jaccard word-overlap similarity."""
    words1 = set(t1.split())
    words2 = set(t2.split())
    if not words1 or not words2:
        return 0
    intersection = words1 & words2
    union = words1 | words2
    return len(intersection) / len(union)


def match_audio_to_written(written_articles, audio_items):
    """Match Audio Long Read episodes to their written counterparts."""
    matches = {}  # audio_id -> written_id
    unmatched = []

    # Build normalized title index for written articles
    written_by_norm_title = {}
    for art in written_articles:
        norm = normalize_title(art["title"])
        written_by_norm_title[norm] = art["id"]

    for audio in audio_items:
        audio_title = audio.get("fields", {}).get("headline", audio.get("webTitle", ""))
        audio_norm = normalize_title(audio_title)
        audio_id = sanitize_id(audio.get("id", ""))

        # Step 1: Exact normalized title match
        if audio_norm in written_by_norm_title:
            matches[audio_id] = written_by_norm_title[audio_norm]
            continue

        # Step 2: Fuzzy Jaccard match
        best_score = 0
        second_best = 0
        best_match = None

        for art in written_articles:
            art_norm = normalize_title(art["title"])
            score = title_similarity(audio_norm, art_norm)

            if score > best_score:
                second_best = best_score
                best_score = score
                best_match = art
            elif score > second_best:
                second_best = score

        # Match if score >= 0.6 and sufficiently better than runner-up
        if best_match and best_score >= 0.6 and (best_score - second_best) >= 0.1:
            # Step 3: Date proximity check as tiebreaker
            matches[audio_id] = best_match["id"]
        else:
            unmatched.append({
                "audio_title": audio.get("fields", {}).get("headline", audio.get("webTitle", "")),
                "audio_id": audio_id,
                "best_match": best_match["title"] if best_match else None,
                "best_score": best_score,
            })

    return matches, unmatched


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    if not API_KEY:
        print("Error: GUARDIAN_API_KEY not set.")
        print("Set it in .env file or export GUARDIAN_API_KEY='your-key'")
        print("Register at: https://open-platform.theguardian.com/access/")
        sys.exit(1)

    # Step 1: Fetch written Long Reads
    print("Fetching written Long Reads...")
    written_raw = fetch_series(LONG_READ_TAG, "written articles")
    print(f"  Total written: {len(written_raw)}")

    # Step 2: Fetch Audio Long Reads
    print("\nFetching Audio Long Reads...")
    audio_raw = fetch_series(AUDIO_LONG_READ_TAG, "audio episodes")
    print(f"  Total audio: {len(audio_raw)}")

    # Step 3: Parse written articles (exclude audio-tagged items)
    print("\nParsing written articles...")
    written_articles = []
    audio_skipped = 0
    for item in written_raw:
        tags = [t.get("id", "") for t in item.get("tags", [])]
        # Skip items that are also tagged as Audio Long Read
        if AUDIO_LONG_READ_TAG in tags:
            audio_skipped += 1
            continue
        # Skip items with /audio/ in their URL (audio versions)
        if "/audio/" in item.get("id", ""):
            audio_skipped += 1
            continue
        article = parse_article(item)
        written_articles.append(article)
    print(f"  Filtered out {audio_skipped} audio items from written results")

    # Step 4: Match audio to written
    print("Matching audio to written articles...")
    matches, unmatched = match_audio_to_written(written_articles, audio_raw)
    print(f"  Matched: {len(matches)}")
    print(f"  Unmatched: {len(unmatched)}")

    if unmatched:
        print("\n  Unmatched audio items:")
        for u in unmatched[:20]:
            best = f" (best: {u['best_match']}, score: {u['best_score']:.2f})" if u["best_match"] else ""
            print(f"    - {u['audio_title']}{best}")
        if len(unmatched) > 20:
            print(f"    ... and {len(unmatched) - 20} more")

    # Step 5: Apply audio URLs to written articles
    written_by_id = {art["id"]: art for art in written_articles}
    audio_by_id = {}
    for item in audio_raw:
        aid = sanitize_id(item.get("id", ""))
        audio_by_id[aid] = item

    for audio_id, written_id in matches.items():
        if written_id in written_by_id and audio_id in audio_by_id:
            written_by_id[written_id]["audio_url"] = audio_by_id[audio_id].get("webUrl", "")
            written_by_id[written_id]["has_audio"] = True

    # Step 6: Save articles
    print(f"\nSaving {len(written_articles)} articles...")
    saved = 0
    skipped = 0

    for article in written_articles:
        path = RAW_DIR / f"{article['id']}.json"
        if path.exists():
            skipped += 1
            continue
        path.write_text(json.dumps(article, indent=2, ensure_ascii=False))
        saved += 1

    # Also save unmatched audio items as standalone articles
    audio_standalone = 0
    for u in unmatched:
        audio_id = u["audio_id"]
        if audio_id in audio_by_id:
            item = audio_by_id[audio_id]
            path = RAW_DIR / f"{audio_id}.json"
            if path.exists():
                continue
            article = parse_article(item)
            article["audio_url"] = item.get("webUrl", "")
            article["has_audio"] = True
            # The article_url is the audio page itself in this case
            path.write_text(json.dumps(article, indent=2, ensure_ascii=False))
            audio_standalone += 1

    print(f"\nDone!")
    print(f"  Written articles saved: {saved} (skipped {skipped} existing)")
    print(f"  Audio-only standalone: {audio_standalone}")
    print(f"  Audio matched to written: {len(matches)}")
    print(f"  Total files: {len(list(RAW_DIR.glob('*.json')))}")


if __name__ == "__main__":
    main()
