/**
 * Article detail panel.
 */

import { DOMAIN_COLORS } from './data.js';

export class DetailPanel {
    constructor(dataStore) {
        this.data = dataStore;
        this.panel = document.getElementById('detail-panel');
        this.content = document.getElementById('panel-content');
        this.closeBtn = document.getElementById('panel-close');
        this.currentArticle = null;

        // Callbacks
        this.onArticleNavigate = null;
        this.onThemeClick = null;
        this.onClose = null;

        this.closeBtn.addEventListener('click', () => this.close());
    }

    show(articleIdx) {
        const art = this.data.articleByIdx.get(articleIdx);
        if (!art) return;

        this.currentArticle = art;
        this.render(art);
        this.panel.classList.remove('hidden');
    }

    close() {
        this.panel.classList.add('hidden');
        this.currentArticle = null;
        if (this.onClose) this.onClose();
    }

    render(art) {
        const connections = this.data.getConnections(art.idx);
        const crossDomain = connections.filter(c => c.type === 'cross_domain');
        const thematic = connections.filter(c => c.type === 'thematic');
        const authorShared = connections.filter(c => c.type === 'author_shared');
        const figureShared = connections.filter(c => c.type === 'figure_shared');

        const readingTime = art.word_count ? Math.max(1, Math.round(art.word_count / 250)) : null;

        this.content.innerHTML = `
            <h2 class="panel-title">${art.title}</h2>
            <div class="panel-date">
                ${this.formatDate(art.date)}
                ${readingTime ? `<span class="reading-time">&middot; ${readingTime} min read</span>` : ''}
                ${art.word_count ? `<span class="word-count">&middot; ${art.word_count.toLocaleString()} words</span>` : ''}
            </div>

            ${this.renderDomains(art)}
            ${this.renderArticleType(art)}

            <div class="panel-synopsis">${art.standfirst || 'No description available.'}</div>

            ${this.renderAuthor(art)}
            ${this.renderThemes(art)}
            ${this.renderConcepts(art)}
            ${this.renderPeopleMentioned(art)}
            ${this.renderFigures(art)}
            ${this.renderTimePeriods(art)}
            ${this.renderBridges(art)}
            ${this.renderConnections('Cross-Domain Connections', crossDomain, art.idx)}
            ${this.renderConnections('Thematic Connections', thematic, art.idx)}
            ${this.renderConnections('Same Author', authorShared, art.idx)}
            ${this.renderConnections('Shared Figures', figureShared, art.idx)}

            <div class="panel-actions">
                <a href="${art.article_url}" target="_blank" rel="noopener" class="panel-link">Read article &rarr;</a>
                ${art.has_audio && art.audio_url ? `<a href="${art.audio_url}" target="_blank" rel="noopener" class="panel-link panel-link-audio">Listen to audio &rarr;</a>` : ''}
            </div>
        `;

        // Add event listeners
        this.content.querySelectorAll('.theme-tag').forEach(tag => {
            tag.addEventListener('click', () => {
                if (this.onThemeClick) this.onThemeClick(tag.dataset.theme);
            });
        });

        this.content.querySelectorAll('.connection-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = parseInt(item.dataset.idx);
                if (this.onArticleNavigate) this.onArticleNavigate(idx);
            });
        });
    }

    renderDomains(art) {
        const domains = art.domain_tags || [];
        if (!domains.length) return '';

        const pills = domains.map(d => {
            const color = DOMAIN_COLORS[d.toLowerCase()] || '#888899';
            return `<span class="domain-pill" style="background:${color}22;color:${color};border:1px solid ${color}44">${d}</span>`;
        }).join('');

        return `<div class="panel-section">${pills}</div>`;
    }

    renderArticleType(art) {
        const type = art.article_type;
        if (!type) return '';

        return `<div class="panel-section"><span class="article-type-badge">${type}</span></div>`;
    }

    renderAuthor(art) {
        const author = art.author;
        if (!author) return '';

        return `
            <div class="panel-section">
                <div class="panel-section-title">Author</div>
                <div class="author-item">
                    <span class="author-name">${author}</span>
                </div>
            </div>
        `;
    }

    renderThemes(art) {
        const themes = art.themes || [];
        if (!themes.length) return '';

        const tags = themes.map(t =>
            `<span class="theme-tag" data-theme="${t}">${t}</span>`
        ).join('');

        return `
            <div class="panel-section">
                <div class="panel-section-title">Themes</div>
                ${tags}
            </div>
        `;
    }

    renderConcepts(art) {
        const concepts = art.abstracted_concepts || [];
        if (!concepts.length) return '';

        const tags = concepts.map(c =>
            `<span class="theme-tag" data-theme="${c}" style="border-color:var(--accent);color:var(--accent)">${c}</span>`
        ).join('');

        return `
            <div class="panel-section">
                <div class="panel-section-title">Abstract Concepts</div>
                ${tags}
            </div>
        `;
    }

    renderPeopleMentioned(art) {
        const people = art.people_mentioned || [];
        if (!people.length) return '';

        const items = people.map(p => `
            <div class="guest-item">
                <span class="guest-name">${p.name || 'Unknown'}</span>
                ${p.role ? `<div class="guest-affiliation">${p.role}</div>` : ''}
            </div>
        `).join('');

        return `
            <div class="panel-section">
                <div class="panel-section-title">People Mentioned</div>
                ${items}
            </div>
        `;
    }

    renderFigures(art) {
        const figures = art.historical_figures || [];
        if (!figures.length) return '';

        return `
            <div class="panel-section">
                <div class="panel-section-title">Historical Figures</div>
                <div style="font-size:13px;color:var(--text)">${figures.join(', ')}</div>
            </div>
        `;
    }

    renderTimePeriods(art) {
        const periods = art.time_periods || [];
        if (!periods.length) return '';

        const items = periods.map(p => {
            const start = p.start_year < 0 ? `${Math.abs(p.start_year)} BCE` : p.start_year;
            const end = p.end_year < 0 ? `${Math.abs(p.end_year)} BCE` : p.end_year;
            return `<div style="font-size:13px">${start} &ndash; ${end}: ${p.label || ''}</div>`;
        }).join('');

        return `
            <div class="panel-section">
                <div class="panel-section-title">Time Periods</div>
                ${items}
            </div>
        `;
    }

    renderBridges(art) {
        const bridges = art.cross_domain_bridges || [];
        if (!bridges.length) return '';

        const items = bridges.map(b =>
            `<div style="font-size:13px;color:var(--text-muted);margin-bottom:6px;line-height:1.5">${b}</div>`
        ).join('');

        return `
            <div class="panel-section">
                <div class="panel-section-title">Cross-Domain Bridges</div>
                ${items}
            </div>
        `;
    }

    renderConnections(title, connections, currentIdx) {
        if (!connections.length) return '';

        const items = connections.map(conn => {
            const otherArt = this.data.getConnectedArticle(conn, currentIdx);
            if (!otherArt) return '';

            const dotColor = (otherArt.domain_tags && otherArt.domain_tags[0])
                ? (DOMAIN_COLORS[otherArt.domain_tags[0]] || '#888899')
                : '#888899';

            return `
                <div class="connection-item" data-idx="${otherArt.idx}">
                    <span class="domain-dot" style="background:${dotColor}"></span>
                    <span class="connection-title">${otherArt.title}</span>
                    <span class="connection-type-badge">${conn.type.replace('_', ' ')}</span>
                    ${conn.explanation ? `<div class="connection-explanation">${conn.explanation}</div>` : ''}
                </div>
            `;
        }).join('');

        return `
            <div class="panel-section">
                <div class="panel-section-title">${title} (${connections.length})</div>
                ${items}
            </div>
        `;
    }

    formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            const date = new Date(dateStr + 'T00:00:00');
            return date.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
            });
        } catch {
            return dateStr;
        }
    }
}
