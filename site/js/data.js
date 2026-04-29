/**
 * Data loading, indexing, and querying for The Long Read Explorer.
 */

// Domain color mapping
export const DOMAIN_COLORS = {
    philosophy: '#9b6dff',
    religion: '#d4a843',
    sociology: '#e08040',
    politics: '#e08040',
    economics: '#e08040',
    anthropology: '#e08040',
    education: '#e08040',
    media: '#e08040',
    language: '#40b8a8',
    linguistics: '#40b8a8',
    science: '#4a8eff',
    mathematics: '#4a8eff',
    technology: '#40b860',
    medicine: '#40b860',
    engineering: '#40b860',
    art: '#e05050',
    music: '#e05050',
    architecture: '#e05050',
    literature: '#e080b0',
    history: '#a07050',
    archaeology: '#a07050',
    military: '#a07050',
    geography: '#888899',
    law: '#888899',
    psychology: '#9b6dff',
};

// Main groupings for the legend
export const DOMAIN_GROUPS = {
    'Philosophy': { color: '#9b6dff', domains: ['philosophy', 'psychology'] },
    'Religion': { color: '#d4a843', domains: ['religion'] },
    'Social Sciences': { color: '#e08040', domains: ['politics', 'economics', 'sociology', 'anthropology', 'education', 'media'] },
    'Language': { color: '#40b8a8', domains: ['language', 'linguistics'] },
    'Science': { color: '#4a8eff', domains: ['science', 'mathematics'] },
    'Technology': { color: '#40b860', domains: ['technology', 'medicine', 'engineering'] },
    'Arts': { color: '#e05050', domains: ['art', 'music', 'architecture'] },
    'Literature': { color: '#e080b0', domains: ['literature'] },
    'History': { color: '#a07050', domains: ['history', 'archaeology', 'military'] },
    'Other': { color: '#888899', domains: ['geography', 'law'] },
};

export class DataStore {
    constructor() {
        this.articles = [];
        this.connections = [];
        this.metadata = {};

        // Indexes
        this.articleByIdx = new Map();
        this.articlesByDomain = new Map();
        this.articlesByTheme = new Map();
        this.articlesByFigure = new Map();
        this.articlesByAuthor = new Map();
        this.connectionsByArticle = new Map();

        // Search index
        this.searchIndex = [];
    }

    async load() {
        const [articlesRes, connectionsRes, metadataRes] = await Promise.all([
            fetch('data/articles.json'),
            fetch('data/connections.json'),
            fetch('data/metadata.json'),
        ]);

        this.articles = await articlesRes.json();
        this.connections = await connectionsRes.json();
        this.metadata = await metadataRes.json();

        this.buildIndexes();
        return this;
    }

    buildIndexes() {
        // Article by index
        for (const art of this.articles) {
            this.articleByIdx.set(art.idx, art);
            art.color = this.getArticleColor(art);
        }

        // Domain index
        for (const art of this.articles) {
            for (const domain of (art.domain_tags || [])) {
                const d = domain.toLowerCase();
                if (!this.articlesByDomain.has(d)) {
                    this.articlesByDomain.set(d, []);
                }
                this.articlesByDomain.get(d).push(art.idx);
            }
        }

        // Theme index
        for (const art of this.articles) {
            for (const theme of (art.themes || [])) {
                const t = theme.toLowerCase();
                if (!this.articlesByTheme.has(t)) {
                    this.articlesByTheme.set(t, []);
                }
                this.articlesByTheme.get(t).push(art.idx);
            }
        }

        // Figure index
        for (const art of this.articles) {
            for (const fig of (art.historical_figures || [])) {
                const f = fig.toLowerCase();
                if (!this.articlesByFigure.has(f)) {
                    this.articlesByFigure.set(f, []);
                }
                this.articlesByFigure.get(f).push(art.idx);
            }
        }

        // Author index
        for (const art of this.articles) {
            const author = (art.author || '').toLowerCase().trim();
            if (author) {
                if (!this.articlesByAuthor.has(author)) {
                    this.articlesByAuthor.set(author, []);
                }
                this.articlesByAuthor.get(author).push(art.idx);
            }
        }

        // Connection index
        for (const conn of this.connections) {
            for (const idx of [conn.source, conn.target]) {
                if (!this.connectionsByArticle.has(idx)) {
                    this.connectionsByArticle.set(idx, []);
                }
                this.connectionsByArticle.get(idx).push(conn);
            }
        }

        // Search index
        this.searchIndex = this.articles.map(art => ({
            idx: art.idx,
            text: [
                art.title || '',
                art.standfirst || '',
                art.author || '',
                ...(art.themes || []),
                ...(art.historical_figures || []),
                ...(art.domain_tags || []),
                ...(art.abstracted_concepts || []),
                ...(art.people_mentioned || []).map(p => p.name || ''),
            ].join(' ').toLowerCase(),
        }));
    }

    getArticleColor(art) {
        const domain = (art.domain_tags || [])[0]?.toLowerCase();
        return DOMAIN_COLORS[domain] || '#888899';
    }

    search(query, limit = 20) {
        if (!query || query.length < 2) return [];

        const terms = query.toLowerCase().split(/\s+/);
        const results = [];

        for (const entry of this.searchIndex) {
            let score = 0;
            const art = this.articleByIdx.get(entry.idx);
            const matchReasons = [];

            for (const term of terms) {
                // Title match is worth the most
                if ((art.title || '').toLowerCase().includes(term)) {
                    score += 10;
                    if (!matchReasons.includes('title')) matchReasons.push('title');
                }
                // Author match
                if ((art.author || '').toLowerCase().includes(term)) {
                    score += 8;
                    if (!matchReasons.includes('author')) matchReasons.push('author');
                }
                // People mentioned match
                const people = art.people_mentioned || [];
                for (const p of people) {
                    if ((p.name || '').toLowerCase().includes(term)) {
                        score += 6;
                        if (!matchReasons.includes('person')) matchReasons.push('person');
                        break;
                    }
                }
                // Theme match
                for (const theme of (art.themes || [])) {
                    if (theme.toLowerCase().includes(term)) {
                        score += 4;
                        if (!matchReasons.includes('theme')) matchReasons.push('theme');
                        break;
                    }
                }
                // Concept match
                for (const concept of (art.abstracted_concepts || [])) {
                    if (concept.toLowerCase().includes(term)) {
                        score += 3;
                        if (!matchReasons.includes('concept')) matchReasons.push('concept');
                        break;
                    }
                }
                // General text match
                if (entry.text.includes(term)) {
                    score += 1;
                }
            }

            if (score > 0) {
                results.push({ idx: entry.idx, score, matchReasons });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit).map(r => {
            const art = this.articleByIdx.get(r.idx);
            return { ...art, matchReasons: r.matchReasons };
        });
    }

    getConnections(articleIdx) {
        return this.connectionsByArticle.get(articleIdx) || [];
    }

    getConnectedArticle(conn, fromIdx) {
        const otherIdx = conn.source === fromIdx ? conn.target : conn.source;
        return this.articleByIdx.get(otherIdx);
    }

    /**
     * Find shortest path between two articles using BFS.
     */
    findPath(startIdx, endIdx) {
        if (startIdx === endIdx) return [startIdx];

        const visited = new Set([startIdx]);
        const queue = [[startIdx]];
        const parentConn = new Map();

        while (queue.length > 0) {
            const path = queue.shift();
            const current = path[path.length - 1];

            const conns = this.getConnections(current);
            for (const conn of conns) {
                const neighbor = conn.source === current ? conn.target : conn.source;

                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    parentConn.set(neighbor, { conn, from: current });
                    const newPath = [...path, neighbor];

                    if (neighbor === endIdx) {
                        return this.buildPathResult(newPath, parentConn);
                    }

                    queue.push(newPath);
                }
            }
        }

        return null;
    }

    buildPathResult(path, parentConn) {
        const result = [];
        for (let i = 0; i < path.length; i++) {
            const art = this.articleByIdx.get(path[i]);
            const step = { article: art, connection: null };

            if (i > 0) {
                const info = parentConn.get(path[i]);
                step.connection = info.conn;
            }

            result.push(step);
        }
        return result;
    }

    /**
     * Get a deterministic "Connection of the Day" based on date.
     */
    getConnectionOfTheDay() {
        const crossDomain = this.connections.filter(c => c.type === 'cross_domain' && c.strength >= 3);
        if (crossDomain.length === 0) return null;

        const today = new Date();
        const dayHash = today.getFullYear() * 366 + today.getMonth() * 31 + today.getDate();
        const idx = dayHash % crossDomain.length;
        const conn = crossDomain[idx];

        return {
            connection: conn,
            articleA: this.articleByIdx.get(conn.source),
            articleB: this.articleByIdx.get(conn.target),
        };
    }

    getRandomArticle() {
        const idx = Math.floor(Math.random() * this.articles.length);
        return this.articles[idx];
    }

    getRandomConnection() {
        const crossDomain = this.connections.filter(c => c.type === 'cross_domain');
        if (crossDomain.length === 0) {
            if (this.connections.length === 0) return null;
            const conn = this.connections[Math.floor(Math.random() * this.connections.length)];
            return {
                connection: conn,
                articleA: this.articleByIdx.get(conn.source),
                articleB: this.articleByIdx.get(conn.target),
            };
        }
        const conn = crossDomain[Math.floor(Math.random() * crossDomain.length)];
        return {
            connection: conn,
            articleA: this.articleByIdx.get(conn.source),
            articleB: this.articleByIdx.get(conn.target),
        };
    }
}
