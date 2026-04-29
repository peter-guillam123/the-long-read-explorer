#!/usr/bin/env python3
"""
Enrich Guardian Long Read articles using Claude API.

Extracts themes, people mentioned, time periods, domain tags, cross-domain bridges,
and abstracted concepts from each article's text.
"""

import json
import os
import sys
import time
from pathlib import Path

import anthropic

BASE_DIR = Path(__file__).parent.parent
RAW_DIR = BASE_DIR / "data" / "raw" / "articles"
ENRICHED_DIR = BASE_DIR / "data" / "enriched" / "articles"

# Load .env
env_path = BASE_DIR / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, val = line.split("=", 1)
            os.environ[key.strip()] = val.strip()

DOMAIN_TAGS = [
    "science", "mathematics", "philosophy", "religion", "literature",
    "history", "politics", "economics", "art", "music", "technology",
    "medicine", "law", "geography", "linguistics", "psychology",
    "sociology", "anthropology", "archaeology", "military", "media",
    "education", "engineering",
]

ENRICHMENT_PROMPT = """Analyze this Guardian Long Read article and return a JSON object. Be precise and thoughtful.

Title: {title}
Date: {date}
Author: {author}
Standfirst: {standfirst}

Article text (excerpt):
{body_excerpt}

Return ONLY valid JSON with these fields:

{{
  "people_mentioned": [
    {{"name": "Full Name", "role": "Brief description of who they are in the article"}}
  ],
  "article_type": "one of: investigation, profile, essay, memoir, reportage, explainer, review, polemic",
  "themes": ["3-8 themes. You MUST choose from this canonical list where possible (add max 1-2 custom if truly needed): 'revolution', 'empire', 'colonialism', 'democracy', 'monarchy', 'power', 'rebellion', 'war', 'diplomacy', 'trade', 'migration', 'nationalism', 'class', 'gender', 'race', 'slavery', 'human rights', 'evolution', 'natural selection', 'genetics', 'cosmology', 'astronomy', 'physics', 'chemistry', 'geology', 'mathematics', 'medicine', 'disease', 'anatomy', 'ecology', 'climate', 'exploration', 'navigation', 'invention', 'industrialisation', 'technology', 'engineering', 'consciousness', 'reason', 'empiricism', 'rationalism', 'idealism', 'materialism', 'existentialism', 'ethics', 'metaphysics', 'epistemology', 'logic', 'aesthetics', 'free will', 'the soul', 'monotheism', 'polytheism', 'mysticism', 'theology', 'scripture', 'heresy', 'reformation', 'secularism', 'faith', 'ritual', 'prophecy', 'tragedy', 'comedy', 'epic', 'romanticism', 'realism', 'modernism', 'poetry', 'the novel', 'drama', 'satire', 'allegory', 'translation', 'rhetoric', 'narrative', 'myth', 'folklore', 'painting', 'sculpture', 'architecture', 'music', 'opera', 'photography', 'cinema', 'patronage', 'beauty', 'capitalism', 'socialism', 'markets', 'taxation', 'poverty', 'wealth', 'labour', 'property', 'law', 'justice', 'punishment', 'sovereignty', 'citizenship', 'education', 'literacy', 'censorship', 'propaganda', 'the press', 'identity', 'memory', 'childhood', 'ageing', 'death', 'love', 'friendship', 'family', 'food', 'language', 'numbers', 'infinity', 'chaos', 'symmetry', 'probability', 'measurement', 'observation', 'experiment', 'classification', 'mapping', 'time', 'space', 'matter', 'energy', 'light', 'gravity', 'entropy', 'the atom', 'the cell', 'the brain', 'extinction', 'biodiversity', 'the ocean', 'the solar system', 'the earth', 'investigation', 'profile', 'memoir', 'inequality', 'corruption', 'technology and society', 'urban life', 'rural life', 'immigration', 'housing', 'healthcare system', 'criminal justice', 'surveillance', 'disinformation', 'globalisation', 'environment', 'mental health'"],
  "time_periods": [
    {{"start_year": 1600, "end_year": 1700, "label": "description of period"}}
  ],
  "geographic_regions": ["relevant regions/countries"],
  "historical_figures": ["key historical/notable people DISCUSSED in the article, not the author"],
  "domain_tags": ["from this set: {domain_tags}"],
  "cross_domain_bridges": [
    "2-4 sentences explaining how this article's topic meaningfully connects to OTHER disciplines. Be specific and grounded in real-world connections."
  ],
  "abstracted_concepts": ["3-5 from this list: 'paradigm shift', 'individual vs collective', 'sacred vs secular', 'center vs periphery', 'theory vs observation', 'nature vs nurture', 'order vs chaos', 'tradition vs innovation', 'reason vs emotion', 'freedom vs control', 'continuity vs change', 'local vs universal', 'visible vs invisible', 'cause and effect', 'unintended consequences', 'classification and taxonomy', 'origins and foundations', 'decline and fall', 'renaissance and revival', 'transmission of knowledge', 'power and resistance', 'genius and collaboration', 'the role of chance', 'scale and proportion', 'boundary crossing', 'utopia and dystopia', 'canon formation', 'translation and transformation', 'measurement and precision', 'thought experiments'"]
}}

For people_mentioned, list the main people discussed or profiled in the article.
For historical_figures, list notable historical figures referenced.
For cross_domain_bridges, think about what connections this article's topic has to other fields.
For abstracted_concepts, think about the deep structural patterns in this topic."""


def truncate_to_words(text, max_words=2000):
    """Truncate text to approximately max_words words."""
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]) + "..."


def enrich_article(client, article):
    """Send article to Claude for enrichment."""
    body_excerpt = truncate_to_words(article.get("body_text", ""), 2000)

    prompt = ENRICHMENT_PROMPT.format(
        title=article.get("title", ""),
        date=article.get("date", ""),
        author=article.get("author", "Unknown"),
        standfirst=article.get("standfirst", ""),
        body_excerpt=body_excerpt,
        domain_tags=", ".join(DOMAIN_TAGS),
    )

    max_retries = 2
    for attempt in range(max_retries + 1):
        try:
            message = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )

            response_text = message.content[0].text.strip()

            # Extract JSON from response (handle markdown code blocks)
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

            enrichment = json.loads(response_text)

            # Validate required fields
            required = ["themes", "domain_tags", "abstracted_concepts"]
            for field in required:
                if field not in enrichment or not enrichment[field]:
                    raise ValueError(f"Missing or empty field: {field}")

            return enrichment

        except (json.JSONDecodeError, ValueError) as e:
            if attempt < max_retries:
                print(f"  Retry {attempt + 1} ({e})...", end=" ")
                time.sleep(1)
            else:
                print(f"  FAILED after {max_retries + 1} attempts: {e}")
                return None
        except anthropic.APIError as e:
            if attempt < max_retries and "overloaded" in str(e).lower():
                print(f"  API overloaded, waiting 10s...", end=" ")
                time.sleep(10)
            else:
                print(f"  API error: {e}")
                return None


def main():
    ENRICHED_DIR.mkdir(parents=True, exist_ok=True)

    # Check for API key
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY environment variable not set.")
        print("Export it with: export ANTHROPIC_API_KEY='your-key-here'")
        sys.exit(1)

    client = anthropic.Anthropic()

    # Get all raw articles
    raw_files = sorted(RAW_DIR.glob("*.json"))
    if not raw_files:
        print(f"No raw article files found in {RAW_DIR}")
        print("Run fetch.py first.")
        sys.exit(1)

    print(f"Found {len(raw_files)} raw articles")

    # Process each article
    success = 0
    skipped = 0
    failed = 0

    for i, raw_path in enumerate(raw_files):
        article_id = raw_path.stem
        enriched_path = ENRICHED_DIR / f"{article_id}.json"

        # Skip if already enriched
        if enriched_path.exists():
            skipped += 1
            continue

        # Load raw article
        article = json.loads(raw_path.read_text())

        # Skip if no body text
        body = article.get("body_text", "") or article.get("standfirst", "")
        if not body or len(body) < 50:
            print(f"  [{i+1}/{len(raw_files)}] {article.get('title', article_id)}: skipping (no text)")
            failed += 1
            continue

        print(f"  [{i+1}/{len(raw_files)}] {article.get('title', article_id)[:60]}...", end=" ")

        enrichment = enrich_article(client, article)
        if enrichment:
            # Merge raw data with enrichment
            enriched = {**article, **enrichment}
            enriched_path.write_text(json.dumps(enriched, indent=2, ensure_ascii=False))
            success += 1
            print("ok")
        else:
            failed += 1

        # Brief pause to stay under rate limits
        time.sleep(0.5)

    print(f"\nDone! Success: {success}, Skipped: {skipped}, Failed: {failed}")
    print(f"Total enriched articles: {len(list(ENRICHED_DIR.glob('*.json')))}")


if __name__ == "__main__":
    main()
