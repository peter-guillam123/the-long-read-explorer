#!/usr/bin/env python3
"""
Merge enriched articles and connections into final JSON files for the frontend.
"""

import json
from collections import defaultdict
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
ENRICHED_DIR = BASE_DIR / "data" / "enriched" / "articles"
CONNECTIONS_PATH = BASE_DIR / "data" / "connections" / "connections.json"
OUTPUT_DIR = BASE_DIR / "site" / "data"

# Era buckets — slug, label, [start_year, end_year_exclusive]
# An article belongs to an era if any of its time_periods overlaps the range.
ERAS = [
    ("pre_1900",   "Before 1900",  None, 1900),
    ("1900_1945",  "1900–1945",    1900, 1945),
    ("1945_1989",  "1945–1989",    1945, 1990),
    ("1990s",      "1990s",        1990, 2000),
    ("2000s",      "2000s",        2000, 2010),
    ("2010s",      "2010s",        2010, 2020),
    ("2020s",      "2020s",        2020, 3000),
]


def article_eras(article):
    """Return the set of era slugs the article's time_periods overlap."""
    eras = set()
    for tp in article.get("time_periods", []) or []:
        s = tp.get("start_year")
        e = tp.get("end_year")
        if s is None and e is None:
            continue
        if s is None: s = e
        if e is None: e = s
        # Clamp wild outliers (geological time, far-future)
        if s < -3000: s = -3000
        if e > 2999: e = 2999
        for slug, _, lo, hi in ERAS:
            era_lo = lo if lo is not None else -10000
            era_hi = hi
            if s < era_hi and e >= era_lo:
                eras.add(slug)
    return eras


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load enriched articles
    articles = []
    id_to_idx = {}

    for path in sorted(ENRICHED_DIR.glob("*.json")):
        art = json.loads(path.read_text())
        idx = len(articles)
        id_to_idx[art["id"]] = idx
        art["idx"] = idx
        articles.append(art)

    if not articles:
        print("No enriched articles found. Run enrich.py first.")
        return

    print(f"Loaded {len(articles)} articles")

    # Build articles.json - trim to essential fields for frontend
    frontend_articles = []
    for art in articles:
        frontend_art = {
            "idx": art["idx"],
            "id": art["id"],
            "title": art.get("title", ""),
            "date": art.get("date", ""),
            "author": art.get("author", ""),
            "standfirst": art.get("standfirst", ""),
            "word_count": art.get("word_count", 0),
            "article_url": art.get("article_url", ""),
            "audio_url": art.get("audio_url"),
            "has_audio": art.get("has_audio", False),
            "article_type": art.get("article_type", ""),
            "people_mentioned": art.get("people_mentioned", []),
            "themes": art.get("themes", []),
            "time_periods": art.get("time_periods", []),
            "geographic_regions": art.get("geographic_regions", []),
            "historical_figures": art.get("historical_figures", []),
            "domain_tags": art.get("domain_tags", []),
            "cross_domain_bridges": art.get("cross_domain_bridges", []),
            "abstracted_concepts": art.get("abstracted_concepts", []),
            "film_adaptation": art.get("film_adaptation"),
            "countries": art.get("countries", []),
        }
        frontend_articles.append(frontend_art)

    # Save articles.json
    articles_path = OUTPUT_DIR / "articles.json"
    articles_path.write_text(json.dumps(frontend_articles, ensure_ascii=False))
    size_mb = articles_path.stat().st_size / (1024 * 1024)
    print(f"Saved articles.json ({len(frontend_articles)} articles, {size_mb:.1f} MB)")

    # Load and transform connections
    connections = []
    if CONNECTIONS_PATH.exists():
        raw_connections = json.loads(CONNECTIONS_PATH.read_text())

        for conn in raw_connections:
            source_id = conn.get("source", "")
            target_id = conn.get("target", "")

            if source_id in id_to_idx and target_id in id_to_idx:
                connections.append({
                    "source": id_to_idx[source_id],
                    "target": id_to_idx[target_id],
                    "type": conn.get("type", ""),
                    "strength": conn.get("strength", 1),
                    "explanation": conn.get("explanation", ""),
                    "shared_concepts": conn.get("shared_concepts", []),
                })

    connections_path = OUTPUT_DIR / "connections.json"
    connections_path.write_text(json.dumps(connections, ensure_ascii=False))
    size_kb = connections_path.stat().st_size / 1024
    print(f"Saved connections.json ({len(connections)} connections, {size_kb:.0f} KB)")

    # Build metadata.json
    all_domains = defaultdict(int)
    all_themes = defaultdict(int)
    all_figures = defaultdict(int)
    all_authors = defaultdict(int)
    all_regions = defaultdict(int)
    all_article_types = defaultdict(int)
    film_by_potential = defaultdict(int)
    film_by_category = defaultdict(int)
    film_by_format = defaultdict(int)
    country_counts = defaultdict(int)
    era_counts = defaultdict(int)
    dates = []
    audio_count = 0

    for art in articles:
        for d in art.get("domain_tags", []):
            all_domains[d] += 1
        for t in art.get("themes", []):
            all_themes[t.lower()] += 1
        for f in art.get("historical_figures", []):
            all_figures[f] += 1
        author = art.get("author", "").strip()
        if author:
            all_authors[author] += 1
        for r in art.get("geographic_regions", []):
            all_regions[r] += 1
        art_type = art.get("article_type", "")
        if art_type:
            all_article_types[art_type] += 1
        if art.get("date"):
            dates.append(art["date"])
        if art.get("has_audio"):
            audio_count += 1
        film = art.get("film_adaptation")
        if film:
            film_by_potential[film.get("potential", "unknown")] += 1
            film_by_format[film.get("format", "unknown")] += 1
            for c in film.get("categories", []) or []:
                film_by_category[c] += 1
        for c in art.get("countries", []) or []:
            country_counts[c] += 1
        for era in article_eras(art):
            era_counts[era] += 1

    conn_by_type = defaultdict(int)
    for c in connections:
        conn_by_type[c["type"]] += 1

    metadata = {
        "total_articles": len(articles),
        "total_connections": len(connections),
        "audio_count": audio_count,
        "date_range": {
            "min": min(dates) if dates else "",
            "max": max(dates) if dates else "",
        },
        "domains": sorted(all_domains.keys()),
        "domain_counts": dict(sorted(all_domains.items(), key=lambda x: -x[1])),
        "top_themes": dict(sorted(all_themes.items(), key=lambda x: -x[1])[:100]),
        "top_figures": dict(sorted(all_figures.items(), key=lambda x: -x[1])[:100]),
        "top_authors": dict(sorted(all_authors.items(), key=lambda x: -x[1])[:50]),
        "top_regions": dict(sorted(all_regions.items(), key=lambda x: -x[1])[:50]),
        "article_type_counts": dict(sorted(all_article_types.items(), key=lambda x: -x[1])),
        "connection_types": dict(conn_by_type),
        "film_adaptation_counts": {
            "by_potential": dict(film_by_potential),
            "by_category": dict(sorted(film_by_category.items(), key=lambda x: -x[1])),
            "by_format": dict(film_by_format),
        },
        "country_counts": dict(sorted(country_counts.items(), key=lambda x: -x[1])),
        "era_counts": {slug: era_counts.get(slug, 0) for slug, _, _, _ in ERAS},
        "eras": [{"slug": slug, "label": label} for slug, label, _, _ in ERAS],
    }

    metadata_path = OUTPUT_DIR / "metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False))
    print(f"Saved metadata.json")

    print(f"\nAll files written to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
