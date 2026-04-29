/**
 * Search and filter functionality.
 */

export class Search {
    constructor(dataStore) {
        this.data = dataStore;
        this.searchInput = document.getElementById('search-input');
        this.searchResults = document.getElementById('search-results');
        this.filtersPanel = document.getElementById('filters-panel');
        this.filtersToggle = document.getElementById('filters-toggle');
        this.domainFilters = document.getElementById('domain-filters');
        this.connectionTypeFilters = document.getElementById('connection-type-filters');
        this.yearStart = document.getElementById('year-start');
        this.yearEnd = document.getElementById('year-end');
        this.clearFiltersBtn = document.getElementById('clear-filters');
        this.filterStatus = document.getElementById('filter-status');

        // State
        this.activeDomains = new Set();
        this.activeConnectionTypes = new Set(['cross_domain', 'thematic']);
        this.debounceTimer = null;

        // Callbacks
        this.onArticleSelect = null;
        this.onFilterChange = null;
        this.onConnectionTypesChange = null;

        this.init();
    }

    init() {
        // Search input
        this.searchInput.addEventListener('input', () => {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => this.performSearch(), 300);
        });

        this.searchInput.addEventListener('focus', () => {
            if (this.searchInput.value.length >= 2) {
                this.performSearch();
            }
        });

        // Close search results on click outside
        document.addEventListener('click', (e) => {
            if (!this.searchInput.contains(e.target) && !this.searchResults.contains(e.target)) {
                this.searchResults.classList.add('hidden');
            }
        });

        // Filters toggle
        this.filtersToggle.addEventListener('click', () => {
            this.filtersPanel.classList.toggle('hidden');
        });

        // Clear filters
        this.clearFiltersBtn.addEventListener('click', () => this.clearFilters());

        // Year inputs
        this.yearStart.addEventListener('change', () => this.applyFilters());
        this.yearEnd.addEventListener('change', () => this.applyFilters());

        // Build domain filter chips
        this.buildDomainFilters();
        this.buildConnectionTypeFilters();
    }

    buildDomainFilters() {
        const domains = this.data.metadata.domains || [];
        this.domainFilters.innerHTML = '';

        for (const domain of domains) {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.textContent = domain;
            chip.dataset.domain = domain;

            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
                if (this.activeDomains.has(domain)) {
                    this.activeDomains.delete(domain);
                } else {
                    this.activeDomains.add(domain);
                }
                this.applyFilters();
            });

            this.domainFilters.appendChild(chip);
        }
    }

    buildConnectionTypeFilters() {
        const types = [
            { key: 'cross_domain', label: 'Cross-Domain' },
            { key: 'thematic', label: 'Thematic' },
            { key: 'author_shared', label: 'Same Author' },
            { key: 'figure_shared', label: 'Shared Figure' },
        ];

        this.connectionTypeFilters.innerHTML = '';
        for (const type of types) {
            const chip = document.createElement('span');
            chip.className = 'chip' + (this.activeConnectionTypes.has(type.key) ? ' active' : '');
            chip.textContent = type.label;
            chip.dataset.type = type.key;

            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
                if (this.activeConnectionTypes.has(type.key)) {
                    this.activeConnectionTypes.delete(type.key);
                } else {
                    this.activeConnectionTypes.add(type.key);
                }
                if (this.onConnectionTypesChange) {
                    this.onConnectionTypesChange([...this.activeConnectionTypes]);
                }
            });

            this.connectionTypeFilters.appendChild(chip);
        }
    }

    performSearch() {
        const query = this.searchInput.value.trim();
        if (query.length < 2) {
            this.searchResults.classList.add('hidden');
            return;
        }

        const results = this.data.search(query, 15);
        if (results.length === 0) {
            this.searchResults.innerHTML = '<div class="search-item"><span class="title">No results found</span></div>';
            this.searchResults.classList.remove('hidden');
            return;
        }

        this.searchResults.innerHTML = results.map(art => {
            const reasonLabels = {
                title: 'title',
                author: 'author',
                person: 'person mentioned',
                theme: 'theme',
                concept: 'concept',
            };
            const reasons = (art.matchReasons || [])
                .map(r => reasonLabels[r] || r);
            const matchHint = reasons.length > 0
                ? `<span class="match-hint">Matched: ${reasons.join(', ')}</span>`
                : '';
            return `
                <div class="search-item" data-idx="${art.idx}">
                    <div class="title">${art.title}</div>
                    <div class="meta">${art.date || ''} &middot; ${art.author || ''} &middot; ${(art.domain_tags || []).join(', ')}</div>
                    ${matchHint}
                </div>
            `;
        }).join('');

        // Add click handlers
        this.searchResults.querySelectorAll('.search-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = parseInt(item.dataset.idx);
                this.searchResults.classList.add('hidden');
                this.searchInput.value = '';
                if (this.onArticleSelect) {
                    this.onArticleSelect(idx);
                }
            });
        });

        this.searchResults.classList.remove('hidden');
    }

    applyFilters() {
        let filteredIdxs = null;

        // Domain filter
        if (this.activeDomains.size > 0) {
            const idxs = new Set();
            for (const domain of this.activeDomains) {
                const arts = this.data.articlesByDomain.get(domain) || [];
                for (const idx of arts) idxs.add(idx);
            }
            filteredIdxs = idxs;
        }

        // Year filter
        const startYear = this.yearStart.value ? parseInt(this.yearStart.value) : null;
        const endYear = this.yearEnd.value ? parseInt(this.yearEnd.value) : null;

        if (startYear || endYear) {
            const yearIdxs = new Set();
            for (const art of this.data.articles) {
                const periods = art.time_periods || [];
                for (const period of periods) {
                    const pStart = period.start_year;
                    const pEnd = period.end_year;
                    if (pStart && pEnd) {
                        const matchStart = !startYear || pEnd >= startYear;
                        const matchEnd = !endYear || pStart <= endYear;
                        if (matchStart && matchEnd) {
                            yearIdxs.add(art.idx);
                            break;
                        }
                    }
                }
            }

            if (filteredIdxs) {
                filteredIdxs = new Set([...filteredIdxs].filter(idx => yearIdxs.has(idx)));
            } else {
                filteredIdxs = yearIdxs;
            }
        }

        // Update status
        if (filteredIdxs) {
            this.filterStatus.textContent = `Showing ${filteredIdxs.size} of ${this.data.articles.length} articles`;
        } else {
            this.filterStatus.textContent = '';
        }

        if (this.onFilterChange) {
            this.onFilterChange(filteredIdxs ? [...filteredIdxs] : null);
        }
    }

    clearFilters() {
        this.activeDomains.clear();
        this.yearStart.value = '';
        this.yearEnd.value = '';
        this.filterStatus.textContent = '';

        // Reset domain chips
        this.domainFilters.querySelectorAll('.chip').forEach(chip => {
            chip.classList.remove('active');
        });

        if (this.onFilterChange) {
            this.onFilterChange(null);
        }
    }

    /**
     * Set search to a specific theme (when clicking theme tags).
     */
    searchTheme(theme) {
        this.searchInput.value = theme;
        this.performSearch();
    }
}
