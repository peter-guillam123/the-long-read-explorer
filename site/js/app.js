/**
 * Main application controller for The Long Read Explorer.
 */

import { DataStore } from './data.js';
import { Graph } from './graph.js';
import { Search } from './search.js';
import { DetailPanel } from './detail.js';

class App {
    constructor() {
        this.data = new DataStore();
        this.graph = null;
        this.search = null;
        this.detail = null;

        this.init();
    }

    async init() {
        try {
            await this.data.load();
        } catch (err) {
            document.getElementById('loading-overlay').innerHTML = `
                <p style="color: #e05050;">Failed to load data. Make sure the JSON files are in site/data/.</p>
                <p style="color: var(--text-muted); font-size: 12px; margin-top: 8px;">${err.message}</p>
            `;
            return;
        }

        // Initialize components
        this.graph = new Graph(document.getElementById('graph-container'), this.data);
        this.search = new Search(this.data);
        this.detail = new DetailPanel(this.data);

        // Wire up callbacks
        this.setupCallbacks();

        // Build graph
        this.graph.buildGraph(['cross_domain', 'thematic']);

        // Hide loading overlay
        document.getElementById('loading-overlay').classList.add('hidden');

        // Show connection of the day
        this.showConnectionOfTheDay();

        // Update stats
        this.updateStats();

        // Setup discovery features
        this.setupDiscovery();
        this.setupPathFinder();

        // Deep-link from the films lens page (?article=<id>)
        this.handleDeepLink();
    }

    handleDeepLink() {
        const params = new URLSearchParams(window.location.search);
        const targetId = params.get('article');
        if (!targetId) return;
        const art = this.data.articles.find(a => a.id === targetId);
        if (!art) return;
        this.graph.highlightNode(art.idx);
        this.detail.show(art.idx);
    }

    setupCallbacks() {
        // Graph -> Detail panel
        this.graph.onNodeClick = (node) => {
            this.detail.show(node.idx);
        };

        // Search -> Graph + Detail
        this.search.onArticleSelect = (idx) => {
            this.graph.highlightNode(idx);
            this.detail.show(idx);
        };

        this.search.onFilterChange = (idxs) => {
            this.graph.setFilter(idxs);
        };

        this.search.onConnectionTypesChange = (types) => {
            this.graph.setConnectionTypes(types);
        };

        // Detail panel -> Graph
        this.detail.onArticleNavigate = (idx) => {
            this.graph.highlightNode(idx);
            this.detail.show(idx);
        };

        this.detail.onThemeClick = (theme) => {
            this.search.searchTheme(theme);
        };

        this.detail.onClose = () => {
            this.graph.clearSelection();
        };
    }

    setupDiscovery() {
        // Surprise Me
        document.getElementById('surprise-btn').addEventListener('click', () => {
            // 50% chance of random article, 50% random connection
            if (Math.random() > 0.5) {
                const result = this.data.getRandomConnection();
                if (result) {
                    this.showConnectionSurprise(result);
                    return;
                }
            }

            const art = this.data.getRandomArticle();
            this.graph.highlightNode(art.idx);
            this.detail.show(art.idx);
        });
    }

    showConnectionSurprise(result) {
        const { connection, articleA, articleB } = result;
        this.graph.highlightNode(articleA.idx);
        this.detail.show(articleA.idx);
    }

    showConnectionOfTheDay() {
        const cotd = this.data.getConnectionOfTheDay();
        if (!cotd) return;

        const banner = document.getElementById('cotd-banner');
        const text = document.getElementById('cotd-text');
        const closeBtn = document.getElementById('cotd-close');

        text.innerHTML = `
            Connection of the Day:
            <span class="highlight" style="cursor:pointer" data-idx="${cotd.articleA.idx}">${cotd.articleA.title}</span>
            &harr;
            <span class="highlight" style="cursor:pointer" data-idx="${cotd.articleB.idx}">${cotd.articleB.title}</span>
            &mdash; ${cotd.connection.explanation || ''}
        `;

        // Click handlers for article names
        text.querySelectorAll('[data-idx]').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.idx);
                this.graph.highlightNode(idx);
                this.detail.show(idx);
            });
        });

        closeBtn.addEventListener('click', () => {
            banner.classList.add('hidden');
        });

        banner.classList.remove('hidden');
    }

    setupPathFinder() {
        const modal = document.getElementById('path-modal');
        const openBtn = document.getElementById('path-finder-btn');
        const closeBtn = modal.querySelector('.modal-close');
        const findBtn = document.getElementById('find-path-btn');
        const fromInput = document.getElementById('path-from');
        const toInput = document.getElementById('path-to');
        const resultDiv = document.getElementById('path-result');
        const suggestionsDiv = document.getElementById('path-suggestions');

        let selectedFrom = null;
        let selectedTo = null;
        let activeInput = null;

        openBtn.addEventListener('click', () => {
            modal.classList.remove('hidden');
            fromInput.value = '';
            toInput.value = '';
            resultDiv.innerHTML = '';
            selectedFrom = null;
            selectedTo = null;
        });

        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });

        // Autocomplete for path inputs
        const showSuggestions = (input, isFrom) => {
            const query = input.value.trim();
            if (query.length < 2) {
                suggestionsDiv.classList.add('hidden');
                return;
            }

            activeInput = isFrom ? 'from' : 'to';
            const results = this.data.search(query, 8);

            if (results.length === 0) {
                suggestionsDiv.classList.add('hidden');
                return;
            }

            suggestionsDiv.innerHTML = results.map(art => `
                <div class="search-item" data-idx="${art.idx}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border)">
                    <div class="title" style="font-size:13px">${art.title}</div>
                    <div class="meta" style="font-size:11px;color:var(--text-muted)">${art.date || ''} &middot; ${art.author || ''}</div>
                </div>
            `).join('');

            suggestionsDiv.querySelectorAll('.search-item').forEach(item => {
                item.addEventListener('click', () => {
                    const idx = parseInt(item.dataset.idx);
                    const art = this.data.articleByIdx.get(idx);

                    if (activeInput === 'from') {
                        selectedFrom = idx;
                        fromInput.value = art.title;
                    } else {
                        selectedTo = idx;
                        toInput.value = art.title;
                    }

                    suggestionsDiv.classList.add('hidden');
                });
            });

            suggestionsDiv.classList.remove('hidden');
            suggestionsDiv.style.background = 'var(--bg-elevated)';
            suggestionsDiv.style.border = '1px solid var(--border)';
            suggestionsDiv.style.borderRadius = '8px';
            suggestionsDiv.style.maxHeight = '250px';
            suggestionsDiv.style.overflowY = 'auto';
        };

        let fromTimer, toTimer;
        fromInput.addEventListener('input', () => {
            clearTimeout(fromTimer);
            fromTimer = setTimeout(() => showSuggestions(fromInput, true), 300);
        });

        toInput.addEventListener('input', () => {
            clearTimeout(toTimer);
            toTimer = setTimeout(() => showSuggestions(toInput, false), 300);
        });

        findBtn.addEventListener('click', () => {
            if (selectedFrom === null || selectedTo === null) {
                resultDiv.innerHTML = '<p style="color:var(--text-muted)">Please select both a start and end article.</p>';
                return;
            }

            const path = this.data.findPath(selectedFrom, selectedTo);

            if (!path) {
                resultDiv.innerHTML = '<p style="color:var(--text-muted)">No path found between these articles. They may be in disconnected parts of the graph.</p>';
                return;
            }

            resultDiv.innerHTML = this.renderPath(path);

            // Click handlers for path steps
            resultDiv.querySelectorAll('.path-step-title').forEach(el => {
                el.addEventListener('click', () => {
                    const idx = parseInt(el.dataset.idx);
                    modal.classList.add('hidden');
                    this.graph.highlightNode(idx);
                    this.detail.show(idx);
                });
            });

            // Highlight path in graph
            const pathIdxs = path.map(step => step.article.idx);
            this.graph.highlightPath(pathIdxs);
        });
    }

    renderPath(path) {
        const steps = path.map((step, i) => {
            const art = step.article;
            const color = art.color;

            let connectionInfo = '';
            if (step.connection) {
                connectionInfo = `
                    <div class="path-step-line"></div>
                    <div class="path-step-reason">${step.connection.explanation || step.connection.type.replace('_', ' ')}</div>
                `;
            }

            return `
                ${i > 0 ? '<div style="margin-left:5px;height:24px;border-left:2px solid var(--border)"></div>' : ''}
                ${connectionInfo}
                <div class="path-step">
                    <div class="path-step-dot" style="background:${color}"></div>
                    <div class="path-step-content">
                        <div class="path-step-title" data-idx="${art.idx}">${art.title}</div>
                        <div style="font-size:11px;color:var(--text-dim)">${art.date || ''} &middot; ${(art.domain_tags || []).join(', ')}</div>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div style="margin-top:16px">
                <p style="color:var(--text-muted);margin-bottom:12px;font-size:13px">
                    Path found: ${path.length} articles, ${path.length - 1} connections
                </p>
                ${steps}
            </div>
        `;
    }

    updateStats() {
        const stats = document.getElementById('stats-text');
        const arts = this.data.articles.length;
        const conns = this.data.connections.length;
        const crossDomain = this.data.connections.filter(c => c.type === 'cross_domain').length;
        stats.textContent = `${arts} articles | ${conns} connections (${crossDomain} cross-domain)`;
    }
}

// Boot
const app = new App();
window.__app = app;
