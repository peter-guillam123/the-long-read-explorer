/**
 * Films from the long read — lens page controller.
 *
 * Loads articles.json + metadata.json, filters to articles with a
 * film_adaptation field, renders a card grid with category / format /
 * potential filters and a sort control.
 */

const CATEGORIES = [
    ["twisty_mystery",            "Twisty mystery"],
    ["hidden_world",              "Hidden world"],
    ["phenomenal_individual",     "Phenomenal individual"],
    ["heist_con",                 "Heist / con"],
    ["david_vs_goliath",          "David vs Goliath"],
    ["whistleblower",             "Whistleblower"],
    ["survival",                  "Survival"],
    ["forensic_chase",            "Forensic chase"],
    ["origin_moment",             "Origin moment"],
    ["closed_community_upheaval", "Community upheaval"],
    ["ethical_choice",            "Ethical choice"],
    ["visual_spectacle",          "Visual spectacle"],
    ["espionage",                 "Espionage"],
];

const CATEGORY_LABELS = Object.fromEntries(CATEGORIES);

const FORMATS = [
    ["fiction", "Fiction"],
    ["documentary", "Documentary"],
    ["either", "Fiction or documentary"],
];

const POTENTIALS = [
    ["high", "High only"],
    ["high_medium", "High + medium"],
];

const POTENTIAL_RANK = { high: 3, medium: 2, low: 1, none: 0 };

class FilmLens {
    constructor() {
        this.articles = [];
        this.metadata = null;
        this.filters = {
            categories: new Set(),
            formats: new Set(),
            potential: "high_medium",
        };
        this.sort = "potential";
        this.init();
    }

    async init() {
        try {
            const [articlesRes, metadataRes] = await Promise.all([
                fetch("data/articles.json"),
                fetch("data/metadata.json"),
            ]);
            const allArticles = await articlesRes.json();
            this.metadata = await metadataRes.json();

            this.articles = allArticles.filter(
                a => a.film_adaptation && a.film_adaptation.potential &&
                     a.film_adaptation.potential !== "none" &&
                     a.film_adaptation.potential !== "low"
            );
        } catch (err) {
            this.showError(err);
            return;
        }

        document.getElementById("film-loading").classList.add("hidden");
        this.renderControls();
        this.render();
    }

    showError(err) {
        const loading = document.getElementById("film-loading");
        loading.innerHTML = `
            <p style="color:#e05050">Couldn't load the data.</p>
            <p style="font-size:12px;margin-top:8px;color:var(--text-dim)">${err.message}</p>
            <p style="font-size:12px;margin-top:12px">
                If the merge step hasn't run yet, the lens page is empty.
                Run <code>python3 scripts/film_pass.py</code> followed by
                <code>python3 scripts/merge.py</code>.
            </p>
        `;
    }

    renderControls() {
        const counts = (this.metadata?.film_adaptation_counts) || {};
        const catCounts = counts.by_category || {};
        const fmtCounts = counts.by_format || {};
        const potCounts = counts.by_potential || {};

        const catChips = document.getElementById("film-category-chips");
        catChips.innerHTML = CATEGORIES.map(([slug, label]) => {
            const n = catCounts[slug] || 0;
            return `<button class="chip" data-cat="${slug}">${label}<span class="chip-count">${n}</span></button>`;
        }).join("");
        catChips.addEventListener("click", e => {
            const btn = e.target.closest("[data-cat]");
            if (!btn) return;
            const slug = btn.dataset.cat;
            this.filters.categories.has(slug)
                ? this.filters.categories.delete(slug)
                : this.filters.categories.add(slug);
            btn.classList.toggle("active");
            this.render();
        });

        const fmtChips = document.getElementById("film-format-chips");
        fmtChips.innerHTML = FORMATS.map(([slug, label]) => {
            const n = fmtCounts[slug] || 0;
            return `<button class="chip" data-fmt="${slug}">${label}<span class="chip-count">${n}</span></button>`;
        }).join("");
        fmtChips.addEventListener("click", e => {
            const btn = e.target.closest("[data-fmt]");
            if (!btn) return;
            const slug = btn.dataset.fmt;
            this.filters.formats.has(slug)
                ? this.filters.formats.delete(slug)
                : this.filters.formats.add(slug);
            btn.classList.toggle("active");
            this.render();
        });

        const potChips = document.getElementById("film-potential-chips");
        const highCount = potCounts.high || 0;
        const mediumCount = potCounts.medium || 0;
        potChips.innerHTML = `
            <button class="chip ${this.filters.potential === "high" ? "active" : ""}" data-pot="high">High only<span class="chip-count">${highCount}</span></button>
            <button class="chip ${this.filters.potential === "high_medium" ? "active" : ""}" data-pot="high_medium">+ Medium<span class="chip-count">${highCount + mediumCount}</span></button>
        `;
        potChips.addEventListener("click", e => {
            const btn = e.target.closest("[data-pot]");
            if (!btn) return;
            this.filters.potential = btn.dataset.pot;
            potChips.querySelectorAll("[data-pot]").forEach(b =>
                b.classList.toggle("active", b.dataset.pot === this.filters.potential)
            );
            this.render();
        });

        const sortSel = document.getElementById("film-sort");
        sortSel.addEventListener("change", () => {
            this.sort = sortSel.value;
            this.render();
        });

        document.getElementById("film-clear").addEventListener("click", () => {
            this.filters.categories.clear();
            this.filters.formats.clear();
            this.filters.potential = "high_medium";
            catChips.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
            fmtChips.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
            potChips.querySelectorAll("[data-pot]").forEach(b =>
                b.classList.toggle("active", b.dataset.pot === "high_medium")
            );
            this.render();
        });

        // Mobile: ⋯ button toggles the secondary controls popover
        const secondaryToggle = document.getElementById("film-secondary-toggle");
        const secondary = document.getElementById("film-controls-secondary");
        if (secondaryToggle && secondary) {
            const closeSecondary = () => {
                secondary.classList.remove("is-open");
                secondaryToggle.setAttribute("aria-expanded", "false");
            };
            secondaryToggle.addEventListener("click", e => {
                e.stopPropagation();
                const isOpen = secondary.classList.toggle("is-open");
                secondaryToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
            });
            document.addEventListener("click", e => {
                if (!secondary.classList.contains("is-open")) return;
                if (secondary.contains(e.target) || secondaryToggle.contains(e.target)) return;
                closeSecondary();
            });
            document.addEventListener("keydown", e => {
                if (e.key === "Escape" && secondary.classList.contains("is-open")) closeSecondary();
            });
        }
    }

    updateSecondaryDot() {
        const dot = document.getElementById("film-secondary-dot");
        if (!dot) return;
        const active = this.filters.formats.size > 0 || this.filters.potential !== "high_medium";
        dot.classList.toggle("hidden", !active);
    }

    filterArticles() {
        return this.articles.filter(art => {
            const film = art.film_adaptation;
            if (!film) return false;

            if (this.filters.potential === "high" && film.potential !== "high") return false;

            if (this.filters.categories.size > 0) {
                const cats = film.categories || [];
                const hit = cats.some(c => this.filters.categories.has(c));
                if (!hit) return false;
            }

            if (this.filters.formats.size > 0) {
                if (!this.filters.formats.has(film.format)) return false;
            }

            return true;
        });
    }

    sortArticles(arts) {
        const sorted = [...arts];
        if (this.sort === "potential") {
            sorted.sort((a, b) => {
                const pa = POTENTIAL_RANK[a.film_adaptation.potential] || 0;
                const pb = POTENTIAL_RANK[b.film_adaptation.potential] || 0;
                if (pa !== pb) return pb - pa;
                return (b.date || "").localeCompare(a.date || "");
            });
        } else if (this.sort === "newest") {
            sorted.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        } else if (this.sort === "oldest") {
            sorted.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
        } else if (this.sort === "random") {
            for (let i = sorted.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
            }
        }
        return sorted;
    }

    render() {
        const filtered = this.filterArticles();
        const sorted = this.sortArticles(filtered);

        const grid = document.getElementById("film-grid");
        const empty = document.getElementById("film-empty");
        const status = document.getElementById("film-status");
        const stats = document.getElementById("film-stats");

        status.textContent = `${sorted.length} of ${this.articles.length} pieces shown`;
        stats.textContent = `${this.articles.length} pieces flagged for film potential`;
        this.updateSecondaryDot();

        if (sorted.length === 0) {
            grid.innerHTML = "";
            empty.classList.remove("hidden");
            return;
        }
        empty.classList.add("hidden");

        grid.innerHTML = sorted.map(art => this.renderCard(art)).join("");
    }

    renderCard(art) {
        const film = art.film_adaptation;
        const cats = (film.categories || []).slice(0, 3);
        const catBadges = cats.map((slug, i) => {
            const label = CATEGORY_LABELS[slug] || slug;
            return `<span class="film-cat-badge ${i === 0 ? "lead" : ""}">${escapeHtml(label)}</span>`;
        }).join("");

        const reading = Math.max(1, Math.round((art.word_count || 0) / 200));
        const meta = [art.author, formatDate(art.date), `${reading} min read`]
            .filter(Boolean).map(escapeHtml).join(" &middot; ");

        const cf = (film.comparable_works || []).length
            ? `<span class="film-card-cf">cf. ${film.comparable_works.map(escapeHtml).join(", ")}</span>`
            : "";

        const fmt = film.format || "either";
        const pot = film.potential || "medium";

        const articleUrl = art.article_url || `https://www.theguardian.com/${art.id}`;

        return `
            <article class="film-card">
                <div class="film-card-cats">${catBadges || '<span class="film-cat-badge">—</span>'}</div>
                <a class="film-card-title" href="${escapeAttr(articleUrl)}" target="_blank" rel="noopener">${escapeHtml(art.title || "")}</a>
                <div class="film-card-meta">${meta}</div>
                <div class="film-card-pitch">${escapeHtml(film.pitch || "")}</div>
                <div class="film-card-bottom">
                    <span class="film-format-badge ${fmt}">${fmt === "either" ? "Fiction or doc" : capitalise(fmt)}</span>
                    <span class="film-potential-badge ${pot}">${capitalise(pot)} potential</span>
                    ${cf}
                    <span class="film-card-links">
                        <a class="film-card-link" href="${escapeAttr(articleUrl)}" target="_blank" rel="noopener">Read &rarr;</a>
                        <a class="film-card-link" href="index.html?article=${escapeAttr(art.id)}">On the graph &rarr;</a>
                    </span>
                </div>
            </article>
        `;
    }
}

function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttr(s) {
    return escapeHtml(s);
}

function capitalise(s) {
    if (!s) return "";
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(d) {
    if (!d) return "";
    const dt = new Date(d);
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

new FilmLens();
