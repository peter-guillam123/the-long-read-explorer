# Discovery Platform Blueprint

This document captures the full architecture, prompts, and design decisions from the "In Our Time Explorer" project so you can replicate it for other content archives (Guardian Long Reads, podcasts, essay collections, etc.).

Paste the relevant sections below into a new Claude Code project as your starting prompt.

---

## THE PROMPT

Build a discovery platform for [CONTENT SOURCE] that helps people explore [NUMBER] articles/episodes and discover unexpected connections between them.

### What it should do

1. **Fetch** all content metadata from [SOURCE API/RSS/SCRAPE]
2. **Enrich** each item using Claude API to extract structured themes, domains, concepts, and cross-disciplinary connections
3. **Generate connections** between items using a three-tier approach (index-based, theme-matching, Claude-validated)
4. **Visualise** everything as an interactive network graph with search, filters, and a detail panel

### Architecture: Two phases

#### Phase 1: Data Pipeline (Python)

Four scripts run in sequence. Each is resume-capable (skips already-processed files).

**Script 1: `scripts/fetch.py`** — Fetch all content metadata
- Paginate through the source API/RSS feed to get every item
- For each item, fetch full details (title, date, body/synopsis, author, URL, categories)
- Rate limit: 1 req/sec with respectful User-Agent
- Save each item as JSON in `data/raw/items/`
- Resume-capable (skip existing files)

**Script 2: `scripts/enrich.py`** — Claude API enrichment
- Send each item's metadata to Claude Sonnet to extract structured fields
- Use a CANONICAL THEME VOCABULARY (see below) — this is critical for connection quality
- Save enriched JSON in `data/enriched/items/`
- Cost estimate: ~$6-8 per 1,000 items with Sonnet

**Script 3: `scripts/connect.py`** — Generate connections (three tiers)

| Tier | Method | Cost | What it finds |
|------|--------|------|---------------|
| 1: Index-based | Shared authors/guests, shared historical figures, overlapping time periods | $0 | Direct factual overlaps |
| 2: Theme matching | Inverted index on themes + abstracted_concepts; find items sharing 2+ themes across DIFFERENT domains | $0 | Thematic resonance |
| 3: Cross-domain validation | Send top ~500-1000 cross-domain pairs to Claude for rating (1-5) and explanation | ~$1-2 | Deep, surprising connections |

Each connection has: source, target, type, strength (1-5), explanation text, shared_concepts.

**Script 4: `scripts/merge.py`** — Produce frontend JSON
- `site/data/episodes.json` — all items with enrichment
- `site/data/connections.json` — all connections with types and explanations
- `site/data/metadata.json` — aggregated stats, domain lists, theme counts

#### Phase 2: Frontend (Vanilla JS + D3.js)

Static site served from `site/` folder. No build step, no framework.

```
site/
  index.html
  css/styles.css
  js/
    app.js        # Main controller, discovery features
    graph.js      # D3.js canvas-based force graph
    search.js     # Search and filter logic
    detail.js     # Episode/article detail panel
    data.js       # Data loading and indexing
  data/           # Final JSON files
```

### Critical design decisions

**1. Canvas rendering, not SVG** — SVG chokes above ~500 nodes. Use HTML5 Canvas with D3 force simulation. Use a quadtree for mouse hit detection.

**2. Canonical theme vocabulary** — This is THE most important design decision. Without it, Claude gives each item poetically unique theme names ("solar system architecture" vs "cosmological revolution") that never match. Force Claude to pick from a controlled list of ~150 terms. Allow max 1-2 custom additions per item.

**3. Three-tier connections** — No single approach works:
- Tier 1 (index) catches obvious links (same author, same figure)
- Tier 2 (themes) catches conceptual resonance across domains
- Tier 3 (Claude validation) catches deep surprising connections and provides explanations

**4. Cross-domain scoring bonuses** — When two items share themes but are in DIFFERENT domains, that's more interesting. Give distance bonuses: science↔literature = 3x, philosophy↔economics = 2x, etc.

**5. On-demand link rendering** — Don't render all connection types as permanent graph edges (too dense). Show cross_domain + thematic by default. When a node is selected, temporarily draw dashed lines to ALL connected nodes (including shared-author connections).

**6. Node locking** — When a node is selected and the detail panel is open, lock the highlight to that node. Hovering over connected nodes shows their tooltips without changing the highlight anchor. This lets users explore a node's neighbourhood.

---

## ENRICHMENT PROMPT

This is the exact prompt structure. Adapt the canonical lists for your content domain.

```
Analyse this [article/episode] and extract structured metadata.

Title: {title}
Date: {date}
Synopsis: {synopsis}
Categories: {categories}

Return ONLY valid JSON with these fields:

{
  "guests": [
    {"name": "Full Name", "affiliation": "Their role/institution as described"}
  ],
  "themes": ["3-8 themes. You MUST choose from this canonical list where possible (add max 1-2 custom if truly needed): 'revolution', 'empire', 'colonialism', 'democracy', 'monarchy', 'power', 'rebellion', 'war', 'diplomacy', 'trade', 'migration', 'nationalism', 'class', 'gender', 'race', 'slavery', 'human rights', 'evolution', 'natural selection', 'genetics', 'cosmology', 'astronomy', 'physics', 'chemistry', 'geology', 'mathematics', 'medicine', 'disease', 'anatomy', 'ecology', 'climate', 'exploration', 'navigation', 'invention', 'industrialisation', 'technology', 'engineering', 'consciousness', 'reason', 'empiricism', 'rationalism', 'idealism', 'materialism', 'existentialism', 'ethics', 'metaphysics', 'epistemology', 'logic', 'aesthetics', 'free will', 'the soul', 'monotheism', 'polytheism', 'mysticism', 'theology', 'scripture', 'heresy', 'reformation', 'secularism', 'faith', 'ritual', 'prophecy', 'tragedy', 'comedy', 'epic', 'romanticism', 'realism', 'modernism', 'poetry', 'the novel', 'drama', 'satire', 'allegory', 'translation', 'rhetoric', 'narrative', 'myth', 'folklore', 'painting', 'sculpture', 'architecture', 'music', 'opera', 'photography', 'cinema', 'patronage', 'beauty', 'capitalism', 'socialism', 'markets', 'taxation', 'poverty', 'wealth', 'labour', 'property', 'law', 'justice', 'punishment', 'sovereignty', 'citizenship', 'education', 'literacy', 'censorship', 'propaganda', 'the press', 'identity', 'memory', 'childhood', 'ageing', 'death', 'love', 'friendship', 'family', 'food', 'language', 'numbers', 'infinity', 'chaos', 'symmetry', 'probability', 'measurement', 'observation', 'experiment', 'classification', 'mapping', 'time', 'space', 'matter', 'energy', 'light', 'gravity', 'entropy', 'the atom', 'the cell', 'the brain', 'extinction', 'biodiversity', 'the ocean', 'the solar system', 'the earth'"],
  "time_periods": [
    {"start_year": 1600, "end_year": 1700, "label": "description of period"}
  ],
  "geographic_regions": ["relevant regions/countries"],
  "historical_figures": ["key people DISCUSSED, not the author/presenter"],
  "domain_tags": ["from this set: science, mathematics, philosophy, history, literature, art, music, religion, politics, economics, sociology, anthropology, psychology, law, medicine, technology, education, linguistics, geography, military, archaeology, theology, ethics, logic, astronomy, biology, chemistry, physics, ecology, genetics, geology, engineering, neuroscience, paleontology, zoology, marine biology, media, architecture"],
  "cross_domain_bridges": [
    "2-4 sentences explaining how this topic meaningfully connects to OTHER disciplines. Be specific and historically grounded."
  ],
  "abstracted_concepts": ["3-5 from this list: 'paradigm shift', 'individual vs collective', 'sacred vs secular', 'center vs periphery', 'theory vs observation', 'nature vs nurture', 'order vs chaos', 'tradition vs innovation', 'reason vs emotion', 'freedom vs control', 'continuity vs change', 'local vs universal', 'visible vs invisible', 'cause and effect', 'unintended consequences', 'classification and taxonomy', 'origins and foundations', 'decline and fall', 'renaissance and revival', 'transmission of knowledge', 'power and resistance', 'genius and collaboration', 'the role of chance', 'scale and proportion', 'boundary crossing', 'utopia and dystopia', 'canon formation', 'translation and transformation', 'measurement and precision', 'thought experiments'"]
}
```

---

## DOMAIN COLOUR SCHEME

10 colour groups that map ~38 fine-grained domains to colours for the graph and UI:

```javascript
const DOMAIN_GROUPS = {
  'Philosophy & Psychology': { color: '#9b6dff', domains: ['philosophy', 'psychology', 'logic', 'ethics'] },
  'Religion & Theology':     { color: '#d4a843', domains: ['religion', 'theology'] },
  'Social Sciences':         { color: '#e08040', domains: ['politics', 'economics', 'sociology', 'anthropology', 'education', 'media'] },
  'Language & Linguistics':  { color: '#40b8a8', domains: ['language', 'linguistics'] },
  'Science & Mathematics':   { color: '#4a8eff', domains: ['science', 'mathematics', 'astronomy', 'biology', 'chemistry', 'physics', 'ecology', 'genetics', 'geology', 'neuroscience', 'paleontology', 'zoology', 'marine biology'] },
  'Technology & Medicine':   { color: '#40b860', domains: ['technology', 'medicine', 'engineering'] },
  'Arts':                    { color: '#e05050', domains: ['art', 'music', 'architecture', 'photography', 'cinema'] },
  'Literature':              { color: '#e080b0', domains: ['literature'] },
  'History & Geography':     { color: '#a07050', domains: ['history', 'archaeology', 'military', 'geography'] },
  'Other':                   { color: '#888899', domains: ['law'] },
};
```

Dark theme CSS variables:
```css
--bg: #0a0a0f;
--bg-surface: #13131a;
--bg-elevated: #1a1a24;
--border: #2a2a3a;
--text: #e0e0e8;
--text-muted: #8888a0;
--accent: #6c8aff;
```

---

## CONNECTION GENERATION DETAILS

### Tier 2: Theme matching (the key algorithm)

Build inverted indexes: theme → [item_ids], concept → [item_ids]

For each item, find others sharing 2+ themes/concepts where domains differ:
```
score = len(shared_themes) + len(shared_concepts) * 2
```

Apply cross-domain distance bonuses for surprising connections:
```python
DOMAIN_DISTANCES = {
    frozenset({'science', 'literature'}): 3,
    frozenset({'mathematics', 'art'}): 3,
    frozenset({'philosophy', 'economics'}): 2,
    frozenset({'religion', 'science'}): 3,
    # etc.
}
```

### Tier 3: Claude validation prompt

```
Rate these [article/episode] pairs for cross-disciplinary connection strength.

For each pair, rate 1-5 (5 = profound connection, 1 = superficial) and explain the connection in one sentence.
Only return pairs rated 3 or above.

Return a JSON array of objects with: pair_index, rating, explanation.
```

Send batches of 8 pairs per API call. Only validate the top ~500-1000 candidates from Tier 2.

---

## FRONTEND FEATURES

### Must-have
- **Network graph** with canvas rendering and D3 force simulation
- **Search** across titles, themes, figures, domains (debounced, scored)
- **Domain filter chips** and **year range** inputs
- **Detail panel** (right sidebar) with full metadata and grouped connections
- **Connection type toggles** (which link types to show in the graph)

### Discovery features
- **"Surprise Me"** button — 50/50 random item or random cross-domain connection
- **"Connection of the Day"** — deterministic daily highlight using date-based hash: `(year * 366 + month * 31 + day) % count`
- **"Path Finder"** — BFS shortest path between any two items through the connection graph. "How does quantum mechanics connect to Shakespeare in 3 steps?"

### Graph interaction model
1. **Default**: all nodes visible, links faded
2. **Hover**: highlight node + all connected nodes/links, dim rest. Show tooltip with connection list.
3. **Click**: select node, open detail panel, LOCK highlight (hovering other nodes shows tooltips but doesn't move the highlight anchor)
4. **Click connected node**: navigate to it (becomes new selection)

---

## ADAPTING FOR GUARDIAN LONG READS

Key differences from In Our Time:

1. **Fetching**: Use Guardian Open Platform API (free key at open-platform.theguardian.com). Query: `section=news/series/the-long-read` with pagination. Each article has full body text available.

2. **Enrichment**: Since you have full article text (not just a synopsis), the enrichment will be much richer. You may want to truncate to first ~2000 words to keep API costs down. Replace "guests" with "author" and "people_mentioned".

3. **Canonical themes**: The same list works well for Long Reads since they cover similar breadth (politics, science, culture, etc.). You may want to add journalism-specific themes: 'investigation', 'profile', 'memoir', 'inequality', 'corruption', 'technology and society', 'urban life', 'rural life', 'immigration', 'housing', 'healthcare system', 'criminal justice'.

4. **Domain tags**: Same set works. Long Reads skew more toward social sciences, politics, and culture.

5. **Connections**: Author-shared connections (instead of guest-shared) will be important — many Long Read authors write across topics.

6. **Volume**: Guardian Long Reads has ~1,500+ articles since 2014, similar scale to In Our Time.

---

## REQUIREMENTS

```
# Python
pip install requests anthropic feedparser

# Frontend
# No build step — just serve the site/ folder:
python3 -m http.server 8080 --directory site
```

---

## RUNNING THE PIPELINE

```bash
# 1. Fetch all content
python3 scripts/fetch.py

# 2. Enrich with Claude (needs ANTHROPIC_API_KEY)
export ANTHROPIC_API_KEY='your-key'
python3 scripts/enrich.py

# 3. Generate connections (tiers 1-2 are free, tier 3 needs API key)
python3 scripts/connect.py

# 4. Merge into frontend JSON
python3 scripts/merge.py

# 5. Serve the site
python3 -m http.server 8080 --directory site
# Visit http://localhost:8080
```

Each script is resume-capable. If interrupted, just re-run and it skips completed work.
