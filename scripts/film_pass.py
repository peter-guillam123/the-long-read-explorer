#!/usr/bin/env python3
"""
Add film_adaptation metadata to each enriched article.

A separate Claude pass that adds one nested field per article:

  film_adaptation: {
    potential, categories[], format, pitch, comparable_works[]
  }

The pass is resume-safe: articles that already have film_adaptation are
skipped on a normal run. Use --sample N to run against N evenly-spaced
articles without writing back, for prompt tuning.
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

VALID_POTENTIAL = {"high", "medium", "low", "none"}
VALID_FORMATS = {"fiction", "documentary", "either"}

CATEGORIES = {
    "twisty_mystery":            "Investigations with reveals, deception, identity, hidden truths slowly unspooling.",
    "hidden_world":              "A sub-culture, niche profession or closed community most readers have never seen inside.",
    "phenomenal_individual":     "A person whose feats, obsession or singular ability would carry a film on their own.",
    "heist_con":                 "A caper, scam or audacious scheme — Tinder Swindler, Catch Me If You Can territory.",
    "david_vs_goliath":          "A small actor takes on a much bigger one — Erin Brockovich, The Insider.",
    "whistleblower":             "Exposing institutional rot from inside — Spotlight, The Report.",
    "survival":                  "Physical or psychological extremes — Touching the Void, 127 Hours.",
    "forensic_chase":            "Patient detective work cracking a cold case — Don't F**k With Cats, Mindhunter.",
    "origin_moment":             "The moment a movement, scene, technology or idea began — The Social Network.",
    "closed_community_upheaval": "A small place upended by a single event — Tiger King energy.",
    "ethical_choice":            "A protagonist forced into an impossible decision — Sophie's Choice, The Insider.",
    "visual_spectacle":          "Settings or worlds that demand to be seen — ice caps, particle colliders, deserts.",
    "espionage":                 "Tradecraft, defectors, moles, covert state operations — Cold War or contemporary.",
}

PROMPT = """You are helping the Guardian's multimedia team identify long reads that could translate into a film or documentary.

Read this article and return a JSON object describing its film/documentary adaptation potential.

Title: {title}
Date: {date}
Author: {author}
Standfirst: {standfirst}

Article text (excerpt):
{body_excerpt}

Return ONLY valid JSON with this shape:

{{
  "potential": "high" | "medium" | "low" | "none",
  "categories": [up to 3 slugs from the list below — empty array if none fit],
  "format": "fiction" | "documentary" | "either",
  "pitch": "1-2 sentences. The cinematic hook — what the film/doc is about. Editorial voice: British English, sentence case, concrete specifics over abstractions, no sales-y verbs ('delight', 'empower', 'shocking'). Don't write 'this would make a good film because…' — just the hook itself. If potential is 'low' or 'none', set pitch to null (there is nothing to pitch).",
  "comparable_works": [up to 3 actual films, documentaries or TV series the piece is reminiscent of — leave empty if nothing obvious]
}}

Calibration is important. Most long reads are essays, explainers, surveys or arguments — they should be 'low' or 'none', not 'medium'. Be tough.

- 'high' = a clear protagonist, a strong narrative arc, and a hook a commissioner could pitch in a sentence. Roughly 10-15% of articles.
- 'medium' = promising raw material that would need real development to become a film. The arc may be implicit, the protagonist may be a group, or the story may be one strand of a wider piece. Roughly 20-30%.
- 'low' = interesting writing but fundamentally not film material — broad essays, explainers, polemics, surveys of a phenomenon, historical analysis, opinion pieces, personal columns without a strong arc. The bulk of long reads sit here.
- 'none' = the piece has nothing a film could grab onto.

Two checks before you commit to a rating:
1. Could a director walk away with a 30-second elevator pitch from this piece? If no, it's not 'high'.
2. If you've returned 'medium' or higher with an empty categories list, you've almost certainly mis-rated — drop it to 'low'. The categories below are the lens through which we identify film material; if none of them fit, the piece probably isn't film material.

Default to caution. We'd rather miss a borderline 'medium' than flood the multimedia team with weak suggestions.

Available category slugs (pick 0-3 that genuinely fit):

{category_list}

Format guidance: 'documentary' fits when the real people and events ARE the story (profiles, investigations, witness accounts). 'fiction' fits when the events would dramatise better than they document (composite characters, condensed timelines, interior life). 'either' is genuine — the strongest material can go both ways."""


def truncate_to_words(text, max_words=2000):
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]) + "..."


def build_prompt(article):
    body_excerpt = truncate_to_words(article.get("body_text", ""), 2000)
    category_list = "\n".join(f"  - {slug}: {desc}" for slug, desc in CATEGORIES.items())
    return PROMPT.format(
        title=article.get("title", ""),
        date=article.get("date", ""),
        author=article.get("author", "Unknown"),
        standfirst=article.get("standfirst", ""),
        body_excerpt=body_excerpt,
        category_list=category_list,
    )


def parse_response(response_text):
    response_text = response_text.strip()
    if response_text.startswith("```"):
        lines = response_text.split("\n")
        json_lines = []
        in_block = False
        for line in lines:
            if line.startswith("```") and not in_block:
                in_block = True
                continue
            elif line.startswith("```") and in_block:
                break
            elif in_block:
                json_lines.append(line)
        response_text = "\n".join(json_lines)
    return json.loads(response_text)


def validate(film):
    if film.get("potential") not in VALID_POTENTIAL:
        raise ValueError(f"bad potential: {film.get('potential')!r}")
    if film.get("format") not in VALID_FORMATS:
        raise ValueError(f"bad format: {film.get('format')!r}")
    cats = film.get("categories", [])
    if not isinstance(cats, list):
        raise ValueError("categories must be a list")
    bad = [c for c in cats if c not in CATEGORIES]
    if bad:
        raise ValueError(f"unknown category slugs: {bad}")
    if len(cats) > 3:
        film["categories"] = cats[:3]
    cw = film.get("comparable_works", []) or []
    if not isinstance(cw, list):
        raise ValueError("comparable_works must be a list")
    if len(cw) > 3:
        film["comparable_works"] = cw[:3]
    if film["potential"] in ("low", "none"):
        film["pitch"] = None
    else:
        if not film.get("pitch"):
            raise ValueError("pitch is required for high/medium")
    return film


def call_claude(client, article):
    prompt = build_prompt(article)
    max_retries = 2
    for attempt in range(max_retries + 1):
        try:
            message = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
            return validate(parse_response(message.content[0].text))
        except (json.JSONDecodeError, ValueError) as e:
            if attempt < max_retries:
                print(f"  retry ({e})...", end=" ")
                time.sleep(1)
            else:
                print(f"  FAILED after {max_retries + 1} attempts: {e}")
                return None
        except anthropic.APIError as e:
            if attempt < max_retries and "overloaded" in str(e).lower():
                print(f"  overloaded, waiting 10s...", end=" ")
                time.sleep(10)
            else:
                print(f"  API error: {e}")
                return None


def sample_articles(all_paths, n):
    """Evenly-spaced sample of n articles across the date-sorted set."""
    if n >= len(all_paths):
        return all_paths
    step = len(all_paths) / n
    return [all_paths[int(i * step)] for i in range(n)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, default=0,
                        help="Run on N evenly-spaced articles, print results, do not write.")
    args = parser.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY not set.")
        sys.exit(1)

    client = anthropic.Anthropic()

    enriched_files = sorted(ENRICHED_DIR.glob("*.json"))
    if not enriched_files:
        print(f"No enriched articles found in {ENRICHED_DIR}. Run enrich.py first.")
        sys.exit(1)

    if args.sample:
        targets = sample_articles(enriched_files, args.sample)
        print(f"Sample mode: running on {len(targets)} of {len(enriched_files)} articles. Not writing back.\n")
    else:
        targets = enriched_files
        print(f"Found {len(enriched_files)} enriched articles")

    success = 0
    skipped = 0
    failed = 0

    for i, path in enumerate(targets):
        article = json.loads(path.read_text())

        if not args.sample and "film_adaptation" in article:
            skipped += 1
            continue

        title_short = (article.get("title") or path.stem)[:60]
        print(f"  [{i+1}/{len(targets)}] {title_short}...", end=" ", flush=True)

        film = call_claude(client, article)
        if film is None:
            failed += 1
            continue

        if args.sample:
            print()
            print(f"    {article.get('title')}")
            print(f"    potential: {film['potential']}  format: {film['format']}  cats: {film.get('categories', [])}")
            if film.get("pitch"):
                print(f"    pitch: {film['pitch']}")
            if film.get("comparable_works"):
                print(f"    cf: {', '.join(film['comparable_works'])}")
            print()
        else:
            article["film_adaptation"] = film
            path.write_text(json.dumps(article, indent=2, ensure_ascii=False))
            print(f"ok ({film['potential']})")

        success += 1
        time.sleep(0.5)

    print(f"\nDone. Success: {success}, Skipped: {skipped}, Failed: {failed}")


if __name__ == "__main__":
    main()
