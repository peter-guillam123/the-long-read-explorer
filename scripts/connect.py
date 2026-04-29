#!/usr/bin/env python3
"""
Generate connections between Guardian Long Read articles.

Three tiers:
1. Index-based: shared authors, shared historical figures
2. Theme matching: shared themes and abstracted concepts across different domains
3. Cross-domain validation: Claude-rated connections for the most promising pairs
"""

import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

import anthropic

BASE_DIR = Path(__file__).parent.parent
ENRICHED_DIR = BASE_DIR / "data" / "enriched" / "articles"
CONNECTIONS_DIR = BASE_DIR / "data" / "connections"

# Load .env
env_path = BASE_DIR / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, val = line.split("=", 1)
            os.environ[key.strip()] = val.strip()

VALIDATION_PROMPT = """Rate these Guardian Long Read article pairs for cross-disciplinary connection strength.

For each pair, rate 1-5 (5 = profound connection, 1 = superficial) and explain the connection in one sentence.
Only return pairs rated 3 or above.

Return a JSON array of objects with: pair_index, rating, explanation.

{pairs}

Return ONLY valid JSON: [{{"pair_index": 0, "rating": 4, "explanation": "..."}}]"""


def load_articles():
    """Load all enriched articles."""
    articles = {}
    for path in sorted(ENRICHED_DIR.glob("*.json")):
        art = json.loads(path.read_text())
        articles[art["id"]] = art
    return articles


def build_inverted_indexes(articles):
    """Build inverted indexes for efficient matching."""
    indexes = {
        "authors": defaultdict(set),
        "figures": defaultdict(set),
        "themes": defaultdict(set),
        "concepts": defaultdict(set),
        "domains": defaultdict(set),
        "regions": defaultdict(set),
    }

    for aid, art in articles.items():
        # Author name (normalized)
        author = art.get("author", "").strip().lower()
        if author:
            indexes["authors"][author].add(aid)

        # Historical figures
        for fig in art.get("historical_figures", []):
            indexes["figures"][fig.strip().lower()].add(aid)

        # Themes
        for theme in art.get("themes", []):
            indexes["themes"][theme.strip().lower()].add(aid)

        # Abstracted concepts
        for concept in art.get("abstracted_concepts", []):
            indexes["concepts"][concept.strip().lower()].add(aid)

        # Domain tags
        for domain in art.get("domain_tags", []):
            indexes["domains"][domain.strip().lower()].add(aid)

        # Geographic regions
        for region in art.get("geographic_regions", []):
            indexes["regions"][region.strip().lower()].add(aid)

    return indexes


def get_primary_domain(art):
    """Get the primary domain tag for an article."""
    domains = art.get("domain_tags", [])
    return domains[0].lower() if domains else "unknown"


def tier1_connections(articles, indexes):
    """Tier 1: Index-based connections (no API calls)."""
    connections = []
    seen = set()

    def add_connection(id1, id2, conn_type, detail=""):
        key = tuple(sorted([id1, id2]))
        if key not in seen:
            seen.add(key)
            connections.append({
                "source": id1,
                "target": id2,
                "type": conn_type,
                "strength": 2,
                "explanation": detail,
                "shared_concepts": [],
            })

    # Shared authors
    for name, aids in indexes["authors"].items():
        aid_list = list(aids)
        if len(aid_list) < 2:
            continue
        for i in range(len(aid_list)):
            for j in range(i + 1, len(aid_list)):
                add_connection(
                    aid_list[i], aid_list[j],
                    "author_shared",
                    f"Both written by {name.title()}"
                )

    # Shared historical figures
    for fig, aids in indexes["figures"].items():
        aid_list = list(aids)
        if len(aid_list) < 2:
            continue
        for i in range(len(aid_list)):
            for j in range(i + 1, len(aid_list)):
                add_connection(
                    aid_list[i], aid_list[j],
                    "figure_shared",
                    f"Both discuss {fig.title()}"
                )

    print(f"  Tier 1: {len(connections)} connections (shared authors/figures)")
    return connections, seen


def tier2_connections(articles, indexes, seen):
    """Tier 2: Theme and concept matching across domains."""
    connections = []

    # Build per-article feature sets
    art_features = {}
    for aid, art in articles.items():
        art_features[aid] = {
            "themes": set(t.lower() for t in art.get("themes", [])),
            "concepts": set(c.lower() for c in art.get("abstracted_concepts", [])),
            "domain": get_primary_domain(art),
            "domains": set(d.lower() for d in art.get("domain_tags", [])),
        }

    # For each article, find others with shared themes/concepts in DIFFERENT domains
    aids = list(articles.keys())
    for i in range(len(aids)):
        candidates = []
        feat_i = art_features[aids[i]]

        for j in range(i + 1, len(aids)):
            key = tuple(sorted([aids[i], aids[j]]))
            if key in seen:
                continue

            feat_j = art_features[aids[j]]

            # Only cross-domain connections
            if feat_i["domain"] == feat_j["domain"]:
                continue

            # Score based on shared themes and concepts
            shared_themes = feat_i["themes"] & feat_j["themes"]
            shared_concepts = feat_i["concepts"] & feat_j["concepts"]

            score = len(shared_themes) + len(shared_concepts) * 2

            if score >= 2:
                candidates.append((j, score, shared_themes | shared_concepts))

        # Keep top 10 per article
        candidates.sort(key=lambda x: x[1], reverse=True)
        for j, score, shared in candidates[:10]:
            key = tuple(sorted([aids[i], aids[j]]))
            if key not in seen:
                seen.add(key)
                strength = min(score, 5)
                connections.append({
                    "source": aids[i],
                    "target": aids[j],
                    "type": "thematic",
                    "strength": strength,
                    "explanation": f"Shared concepts: {', '.join(sorted(shared)[:5])}",
                    "shared_concepts": sorted(shared),
                })

    print(f"  Tier 2: {len(connections)} thematic cross-domain connections")
    return connections, seen


def tier3_connections(articles, indexes, seen, connections_so_far):
    """Tier 3: Claude-validated cross-domain connections."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("  Tier 3: Skipped (no ANTHROPIC_API_KEY)")
        return []

    client = anthropic.Anthropic()

    # Find promising cross-domain pairs not yet connected
    art_features = {}
    for aid, art in articles.items():
        art_features[aid] = {
            "concepts": set(c.lower() for c in art.get("abstracted_concepts", [])),
            "bridges": art.get("cross_domain_bridges", []),
            "domain": get_primary_domain(art),
            "title": art.get("title", ""),
            "standfirst": art.get("standfirst", "")[:200],
            "themes": art.get("themes", []),
        }

    # Find pairs sharing concepts across very different domains
    candidate_pairs = []
    aids = list(articles.keys())
    domain_distance = {
        frozenset({"science", "literature"}): 3,
        frozenset({"science", "art"}): 3,
        frozenset({"mathematics", "philosophy"}): 2,
        frozenset({"economics", "literature"}): 3,
        frozenset({"religion", "science"}): 3,
        frozenset({"politics", "art"}): 2,
        frozenset({"military", "literature"}): 2,
        frozenset({"medicine", "philosophy"}): 2,
        frozenset({"technology", "art"}): 3,
        frozenset({"music", "mathematics"}): 2,
        frozenset({"politics", "technology"}): 2,
        frozenset({"economics", "psychology"}): 2,
        frozenset({"law", "technology"}): 2,
        frozenset({"medicine", "economics"}): 2,
    }

    for i in range(len(aids)):
        for j in range(i + 1, len(aids)):
            key = tuple(sorted([aids[i], aids[j]]))
            if key in seen:
                continue

            fi, fj = art_features[aids[i]], art_features[aids[j]]
            shared = fi["concepts"] & fj["concepts"]

            if not shared:
                continue

            # Compute domain distance bonus
            pair_domains = frozenset({fi["domain"], fj["domain"]})
            dist_bonus = domain_distance.get(pair_domains, 1)

            score = len(shared) * dist_bonus
            if score >= 2:
                candidate_pairs.append((aids[i], aids[j], shared, score))

    # Sort by score and take top candidates
    candidate_pairs.sort(key=lambda x: x[3], reverse=True)
    candidate_pairs = candidate_pairs[:800]

    print(f"  Tier 3: Validating {len(candidate_pairs)} candidate pairs with Claude...")

    connections = []
    batch_size = 8

    for batch_start in range(0, len(candidate_pairs), batch_size):
        batch = candidate_pairs[batch_start:batch_start + batch_size]

        pairs_text = ""
        for idx, (id1, id2, shared, score) in enumerate(batch):
            f1 = art_features[id1]
            f2 = art_features[id2]
            pairs_text += f"""
Pair {idx}:
Article A: "{f1['title']}" ({f1['domain']}) - {f1['standfirst']}
Article B: "{f2['title']}" ({f2['domain']}) - {f2['standfirst']}
Shared concepts: {', '.join(shared)}
"""

        try:
            message = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1024,
                messages=[{"role": "user", "content": VALIDATION_PROMPT.format(pairs=pairs_text)}],
            )

            response = message.content[0].text.strip()
            if response.startswith("```"):
                lines = response.split("\n")
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
                response = "\n".join(json_lines)

            results = json.loads(response)

            for r in results:
                pair_idx = r.get("pair_index", -1)
                if 0 <= pair_idx < len(batch):
                    id1, id2, shared, _ = batch[pair_idx]
                    key = tuple(sorted([id1, id2]))
                    seen.add(key)
                    connections.append({
                        "source": id1,
                        "target": id2,
                        "type": "cross_domain",
                        "strength": r.get("rating", 3),
                        "explanation": r.get("explanation", ""),
                        "shared_concepts": sorted(shared),
                    })

        except Exception as e:
            print(f"    Batch error: {e}")

        if batch_start % (batch_size * 5) == 0:
            print(f"    Processed {batch_start + len(batch)}/{len(candidate_pairs)} pairs...")

        time.sleep(0.5)

    print(f"  Tier 3: {len(connections)} validated cross-domain connections")
    return connections


def main():
    CONNECTIONS_DIR.mkdir(parents=True, exist_ok=True)

    # Load enriched articles
    articles = load_articles()
    if not articles:
        print(f"No enriched articles found in {ENRICHED_DIR}")
        print("Run enrich.py first.")
        sys.exit(1)

    print(f"Loaded {len(articles)} enriched articles")

    # Build indexes
    print("Building inverted indexes...")
    indexes = build_inverted_indexes(articles)
    for name, idx in indexes.items():
        print(f"  {name}: {len(idx)} unique values")

    # Generate connections
    print("\nGenerating connections...")
    all_connections = []

    t1, seen = tier1_connections(articles, indexes)
    all_connections.extend(t1)

    t2, seen = tier2_connections(articles, indexes, seen)
    all_connections.extend(t2)

    t3 = tier3_connections(articles, indexes, seen, all_connections)
    all_connections.extend(t3)

    # Summary
    print(f"\nTotal connections: {len(all_connections)}")
    by_type = defaultdict(int)
    for c in all_connections:
        by_type[c["type"]] += 1
    for t, count in sorted(by_type.items()):
        print(f"  {t}: {count}")

    # Save
    output_path = CONNECTIONS_DIR / "connections.json"
    output_path.write_text(json.dumps(all_connections, indent=2, ensure_ascii=False))
    print(f"\nSaved to {output_path}")


if __name__ == "__main__":
    main()
