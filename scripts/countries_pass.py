#!/usr/bin/env python3
"""
Add a normalised `countries` field to each enriched article.

Why this exists: the existing `geographic_regions` field is freeform —
the same place appears as "United Kingdom", "Britain", "UK"; UK pieces
aren't disambiguated to constituent countries; some entries are cities
or continents rather than countries.

This pass asks Claude to read the article and decide which sovereign
countries (or UK constituent countries) the piece is primarily ABOUT —
not just mentioned in passing. Output is a clean array of standardised
country names suitable for filtering.

  "countries": ["Wales", "United States"]

Use --sample N to test the prompt cheaply before a full run.
Use --force to re-process articles that already have a countries field.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import anthropic

BASE_DIR = Path(__file__).parent.parent
ENRICHED_DIR = BASE_DIR / "data" / "enriched" / "articles"

env_path = BASE_DIR / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, val = line.split("=", 1)
            os.environ[key.strip()] = val.strip()


PROMPT = """Read this Guardian Long Read article and return a JSON object listing the countries it's primarily ABOUT — not just mentioned in passing.

Title: {title}
Standfirst: {standfirst}
Existing geographic regions: {existing_regions}

Article text (excerpt):
{body_excerpt}

Rules:

1. Return 1-4 country names in `countries`, ordered by primary focus first. If the piece isn't really about any country (e.g. it's about a global phenomenon or an abstract topic), return an empty array.

2. Standardise to common English country names: "United States" (not "USA" or "America"), "United Kingdom" (NOT this — see rule 3), "Russia", "Germany", etc.

3. **UK pieces must be split into constituent countries**: use "England", "Scotland", "Wales" or "Northern Ireland" — NOT "United Kingdom" or "Britain". Only use "United Kingdom" if the piece is genuinely about the UK as a whole (e.g. a UK-wide policy, parliament, monarchy) without a single constituent country dominating. If the piece is about more than one constituent country (e.g. England and Scotland), include both.

4. **Republic of Ireland** is its own country, not part of the UK.

5. Do NOT include continents or regions ("Europe", "Africa", "Middle East") — those go in `regions` if relevant.

6. Cities and sub-national places resolve to their country (e.g. "London" → "England", "California" → "United States", "Catalonia" → "Spain").

Return ONLY this JSON shape:

{{
  "countries": ["England", "United States"],
  "regions": ["Europe"]
}}

`regions` is optional — include only if the piece is genuinely about a continent or supra-national region in addition to specific countries."""


VALID_UK = {"England", "Scotland", "Wales", "Northern Ireland", "United Kingdom"}


def truncate_to_words(text, max_words=1000):
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]) + "..."


def build_prompt(article):
    body_excerpt = truncate_to_words(article.get("body_text", ""), 1000)
    existing = article.get("geographic_regions", []) or []
    return PROMPT.format(
        title=article.get("title", ""),
        standfirst=article.get("standfirst", ""),
        existing_regions=", ".join(existing) if existing else "(none)",
        body_excerpt=body_excerpt,
    )


def parse_response(text):
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        out, in_block = [], False
        for line in lines:
            if line.startswith("```") and not in_block:
                in_block = True
                continue
            if line.startswith("```") and in_block:
                break
            if in_block:
                out.append(line)
        text = "\n".join(out)
    return json.loads(text)


def validate(parsed):
    countries = parsed.get("countries", [])
    if not isinstance(countries, list):
        raise ValueError("countries must be a list")
    # Strip whitespace, drop empties
    countries = [c.strip() for c in countries if c and c.strip()]
    # Reject free-form "Britain" / "UK" / "USA" sneaking through — flag for retry
    bad_aliases = {"Britain", "Great Britain", "UK", "U.K.", "USA", "U.S.A.", "America", "U.S."}
    if any(c in bad_aliases for c in countries):
        raise ValueError(f"unstandardised country names: {[c for c in countries if c in bad_aliases]}")
    if len(countries) > 4:
        countries = countries[:4]
    regions = parsed.get("regions", []) or []
    if not isinstance(regions, list):
        regions = []
    return {"countries": countries, "regions": [r.strip() for r in regions if r and r.strip()]}


def call_claude(client, article):
    prompt = build_prompt(article)
    for attempt in range(3):
        try:
            msg = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=256,
                messages=[{"role": "user", "content": prompt}],
            )
            return validate(parse_response(msg.content[0].text))
        except (json.JSONDecodeError, ValueError) as e:
            if attempt < 2:
                print(f"  retry ({e})...", end=" ", flush=True)
                time.sleep(1)
            else:
                print(f"  FAILED: {e}")
                return None
        except anthropic.APIError as e:
            if attempt < 2 and "overloaded" in str(e).lower():
                print(f"  overloaded, waiting 10s...", end=" ", flush=True)
                time.sleep(10)
            else:
                print(f"  API error: {e}")
                return None


def sample(paths, n):
    if n >= len(paths):
        return paths
    step = len(paths) / n
    return [paths[int(i * step)] for i in range(n)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, default=0,
                        help="Run on N evenly-spaced articles, print results, do not write.")
    parser.add_argument("--force", action="store_true",
                        help="Re-process articles that already have a countries field.")
    args = parser.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY not set.")
        sys.exit(1)

    client = anthropic.Anthropic()
    files = sorted(ENRICHED_DIR.glob("*.json"))
    if not files:
        print(f"No enriched articles in {ENRICHED_DIR}")
        sys.exit(1)

    targets = sample(files, args.sample) if args.sample else files
    if args.sample:
        print(f"Sample mode: running on {len(targets)} of {len(files)}. Not writing back.\n")
    else:
        print(f"Found {len(files)} articles")

    success = skipped = failed = 0
    for i, path in enumerate(targets):
        article = json.loads(path.read_text())
        if not args.sample and not args.force and "countries" in article:
            skipped += 1
            continue

        title_short = (article.get("title") or path.stem)[:60]
        print(f"  [{i+1}/{len(targets)}] {title_short}...", end=" ", flush=True)

        result = call_claude(client, article)
        if result is None:
            failed += 1
            continue

        if args.sample:
            print()
            existing = article.get("geographic_regions", []) or []
            print(f"    title: {article.get('title')}")
            print(f"    existing regions: {existing}")
            print(f"    countries: {result['countries']}")
            if result.get("regions"):
                print(f"    regions: {result['regions']}")
            print()
        else:
            article["countries"] = result["countries"]
            if result.get("regions"):
                article["regions_normalised"] = result["regions"]
            path.write_text(json.dumps(article, indent=2, ensure_ascii=False))
            print(f"ok ({', '.join(result['countries']) or '—'})")

        success += 1
        time.sleep(0.4)

    print(f"\nDone. Success: {success}, Skipped: {skipped}, Failed: {failed}")


if __name__ == "__main__":
    main()
