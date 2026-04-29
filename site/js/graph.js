/**
 * Canvas-based D3.js force graph for article visualization.
 */

import { DOMAIN_GROUPS } from './data.js';

export class Graph {
    constructor(container, dataStore) {
        this.container = container;
        this.data = dataStore;
        this.canvas = container.querySelector('#graph-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.tooltip = container.querySelector('#graph-tooltip');
        this.legendEl = container.querySelector('#graph-legend');

        // State
        this.nodes = [];
        this.links = [];
        this.simulation = null;
        this.transform = d3.zoomIdentity;
        this.hoveredNode = null;
        this.selectedNode = null;
        this.activeConnectionTypes = new Set(['cross_domain', 'thematic']);
        this.filteredNodeIdxs = null;
        this.quadtree = null;

        // Callbacks
        this.onNodeClick = null;
        this.onNodeHover = null;

        // Settings
        this.nodeRadius = 5;
        this.highlightRadius = 8;

        this.init();
    }

    init() {
        this.resize();
        this.setupZoom();
        this.setupMouse();
        this.buildLegend();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const rect = this.container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.width = rect.width;
        this.height = rect.height;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (this.simulation) {
            this.draw();
        }
    }

    setupZoom() {
        this.zoom = d3.zoom()
            .scaleExtent([0.1, 8])
            .on('zoom', (event) => {
                this.transform = event.transform;
                this.draw();
            });

        d3.select(this.canvas).call(this.zoom);
    }

    setupMouse() {
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left - this.transform.x) / this.transform.k;
            const y = (e.clientY - rect.top - this.transform.y) / this.transform.k;

            const node = this.findNode(x, y);
            if (node !== this.hoveredNode) {
                this.hoveredNode = node;
                this.canvas.style.cursor = node ? 'pointer' : 'default';
                this.draw();

                if (node) {
                    this.showTooltip(node, e.clientX, e.clientY);
                } else {
                    this.hideTooltip();
                }

                if (this.onNodeHover) this.onNodeHover(node);
            } else if (node) {
                this.positionTooltip(e.clientX, e.clientY);
            }
        });

        this.canvas.addEventListener('click', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left - this.transform.x) / this.transform.k;
            const y = (e.clientY - rect.top - this.transform.y) / this.transform.k;

            const node = this.findNode(x, y);
            if (node) {
                this.selectedNode = node;
                this.draw();
                if (this.onNodeClick) this.onNodeClick(node);
            }
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.hoveredNode = null;
            this.hideTooltip();
            this.draw();
        });
    }

    findNode(x, y) {
        if (!this.quadtree) return null;
        const radius = this.highlightRadius / this.transform.k + 2;

        // If a node is selected, only allow finding connected nodes (or the selected node itself)
        if (this.selectedNode) {
            // First check: is the cursor directly over the selected node?
            // If so, return null — no tooltip needed since the detail panel already shows it
            // Use a generous radius that accounts for zoom level
            const selDx = this.selectedNode.x - x;
            const selDy = this.selectedNode.y - y;
            const selDist = Math.sqrt(selDx * selDx + selDy * selDy);
            const selRadius = this.highlightRadius / this.transform.k + 5;
            if (selDist < selRadius) {
                return null;
            }

            const connectedIdxs = new Set();
            for (const link of this.links) {
                if (link.source.idx === this.selectedNode.idx) connectedIdxs.add(link.target.idx);
                if (link.target.idx === this.selectedNode.idx) connectedIdxs.add(link.source.idx);
            }
            // Also include on-demand connections (all connection types)
            for (const conn of this.data.connections) {
                if (conn.source === this.selectedNode.idx) connectedIdxs.add(conn.target);
                if (conn.target === this.selectedNode.idx) connectedIdxs.add(conn.source);
            }

            // Search nearby nodes but only return connected ones (excluding selected node)
            let best = null;
            let bestDist = radius * 2;
            this.quadtree.visit((quad, x0, y0, x1, y1) => {
                if (quad.data) {
                    if (quad.data.idx === this.selectedNode.idx) return;
                    const dx = quad.data.x - x;
                    const dy = quad.data.y - y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < bestDist && connectedIdxs.has(quad.data.idx)) {
                        best = quad.data;
                        bestDist = dist;
                    }
                }
                // Prune branches too far away
                return x0 > x + bestDist || x1 < x - bestDist || y0 > y + bestDist || y1 < y - bestDist;
            });
            return best;
        }

        return this.quadtree.find(x, y, radius * 2) || null;
    }

    buildGraph(connectionTypes = null) {
        if (connectionTypes) {
            this.activeConnectionTypes = new Set(connectionTypes);
        }

        this.nodes = this.data.articles.map(art => ({
            idx: art.idx,
            x: this.width / 2 + (Math.random() - 0.5) * this.width * 0.8,
            y: this.height / 2 + (Math.random() - 0.5) * this.height * 0.8,
            color: art.color,
            article: art,
        }));

        const nodeByIdx = new Map();
        for (const node of this.nodes) {
            nodeByIdx.set(node.idx, node);
        }

        this.links = [];
        for (const conn of this.data.connections) {
            if (!this.activeConnectionTypes.has(conn.type)) continue;

            const source = nodeByIdx.get(conn.source);
            const target = nodeByIdx.get(conn.target);
            if (source && target) {
                this.links.push({
                    source,
                    target,
                    type: conn.type,
                    strength: conn.strength,
                    explanation: conn.explanation,
                });
            }
        }

        this.startSimulation();
    }

    startSimulation() {
        if (this.simulation) {
            this.simulation.stop();
        }

        this.simulation = d3.forceSimulation(this.nodes)
            .force('charge', d3.forceManyBody().strength(-20).distanceMax(200))
            .force('link', d3.forceLink(this.links).strength(l => {
                return l.type === 'cross_domain' ? 0.1 : 0.05;
            }).distance(100))
            .force('center', d3.forceCenter(this.width / 2, this.height / 2))
            .force('collision', d3.forceCollide(this.nodeRadius + 4))
            .alphaDecay(0.02)
            .on('tick', () => {
                this.updateQuadtree();
                this.draw();
            });

        setTimeout(() => {
            if (this.simulation) {
                this.simulation.alphaTarget(0).alphaDecay(0.05);
            }
        }, 3000);
    }

    updateQuadtree() {
        this.quadtree = d3.quadtree()
            .x(d => d.x)
            .y(d => d.y)
            .addAll(this.nodes);
    }

    draw() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.translate(this.transform.x, this.transform.y);
        ctx.scale(this.transform.k, this.transform.k);

        const anchorNode = this.selectedNode || this.hoveredNode;
        const connectedNodes = new Set();
        const activeLinks = new Set();
        const onDemandLinks = [];

        if (anchorNode) {
            connectedNodes.add(anchorNode.idx);
            for (const link of this.links) {
                if (link.source.idx === anchorNode.idx || link.target.idx === anchorNode.idx) {
                    connectedNodes.add(link.source.idx);
                    connectedNodes.add(link.target.idx);
                    activeLinks.add(link);
                }
            }
            if (this.selectedNode === anchorNode) {
                const nodeByIdx = new Map();
                for (const n of this.nodes) nodeByIdx.set(n.idx, n);
                for (const conn of this.data.connections) {
                    if (this.activeConnectionTypes.has(conn.type)) continue;
                    if (conn.source === anchorNode.idx || conn.target === anchorNode.idx) {
                        const otherIdx = conn.source === anchorNode.idx ? conn.target : conn.source;
                        const otherNode = nodeByIdx.get(otherIdx);
                        if (otherNode) {
                            connectedNodes.add(otherIdx);
                            onDemandLinks.push({
                                source: anchorNode,
                                target: otherNode,
                                type: conn.type,
                                strength: conn.strength,
                            });
                        }
                    }
                }
            }
        }

        const hoveredLinkSet = new Set();
        if (this.selectedNode && this.hoveredNode && this.hoveredNode !== this.selectedNode) {
            for (const link of this.links) {
                const connectsSelected = link.source.idx === this.selectedNode.idx || link.target.idx === this.selectedNode.idx;
                const connectsHovered = link.source.idx === this.hoveredNode.idx || link.target.idx === this.hoveredNode.idx;
                if (connectsSelected && connectsHovered) {
                    hoveredLinkSet.add(link);
                }
            }
            for (const link of onDemandLinks) {
                if (link.target.idx === this.hoveredNode.idx || link.source.idx === this.hoveredNode.idx) {
                    hoveredLinkSet.add(link);
                }
            }
        }

        // Draw links
        for (const link of this.links) {
            const isActive = activeLinks.has(link);
            const isHoveredLink = hoveredLinkSet.has(link);
            const dimmed = anchorNode && !isActive;

            ctx.beginPath();
            ctx.moveTo(link.source.x, link.source.y);
            ctx.lineTo(link.target.x, link.target.y);

            if (dimmed) {
                ctx.strokeStyle = 'rgba(40, 40, 60, 0.15)';
                ctx.lineWidth = 0.3;
            } else if (isHoveredLink) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.lineWidth = 2;
            } else if (isActive) {
                ctx.strokeStyle = link.type === 'cross_domain'
                    ? 'rgba(108, 138, 255, 0.7)'
                    : 'rgba(200, 200, 220, 0.4)';
                ctx.lineWidth = Math.max(1, link.strength * 0.5);
            } else {
                ctx.strokeStyle = link.type === 'cross_domain'
                    ? 'rgba(108, 138, 255, 0.15)'
                    : 'rgba(100, 100, 120, 0.08)';
                ctx.lineWidth = 0.5;
            }

            ctx.stroke();
        }

        // Draw on-demand links
        for (const link of onDemandLinks) {
            const isHoveredLink = hoveredLinkSet.has(link);
            ctx.beginPath();
            ctx.moveTo(link.source.x, link.source.y);
            ctx.lineTo(link.target.x, link.target.y);
            if (isHoveredLink) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.lineWidth = 2;
            } else {
                ctx.setLineDash([4, 4]);
                ctx.strokeStyle = 'rgba(160, 180, 255, 0.4)';
                ctx.lineWidth = 0.8;
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw nodes
        for (const node of this.nodes) {
            const isConnected = connectedNodes.has(node.idx);
            const isAnchor = node === anchorNode;
            const isHovered = node === this.hoveredNode;
            const dimmed = anchorNode && !isConnected;

            ctx.beginPath();
            const r = isAnchor ? this.highlightRadius :
                      (isHovered && isConnected) ? this.highlightRadius :
                      isConnected ? this.nodeRadius + 1 : this.nodeRadius;
            ctx.arc(node.x, node.y, r, 0, Math.PI * 2);

            if (dimmed) {
                ctx.fillStyle = 'rgba(40, 40, 60, 0.3)';
            } else {
                ctx.fillStyle = node.color;
                if (isAnchor || (isHovered && isConnected)) {
                    ctx.shadowColor = node.color;
                    ctx.shadowBlur = isAnchor ? 12 : 8;
                }
            }

            ctx.fill();
            ctx.shadowBlur = 0;

            if (node === this.selectedNode) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            if (isHovered && isConnected && this.selectedNode && node !== this.selectedNode) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        ctx.restore();
    }

    showTooltip(node, clientX, clientY) {
        const art = node.article;
        const domain = (art.domain_tags || [])[0] || '';
        const color = art.color;

        const connected = [];
        for (const link of this.links) {
            if (link.source.idx === node.idx) {
                connected.push({ article: link.target.article, type: link.type });
            } else if (link.target.idx === node.idx) {
                connected.push({ article: link.source.article, type: link.type });
            }
        }

        const typeLabels = {
            cross_domain: 'Cross-domain',
            thematic: 'Thematic',
            figure_shared: 'Shared figures',
            author_shared: 'Same author',
        };

        let connectionsHtml = '';
        if (connected.length > 0) {
            const byType = {};
            for (const c of connected) {
                if (!byType[c.type]) byType[c.type] = [];
                byType[c.type].push(c.article);
            }

            connectionsHtml = '<div class="tooltip-connections">';
            for (const [type, arts] of Object.entries(byType)) {
                const label = typeLabels[type] || type;
                const shown = arts.slice(0, 5);
                const more = arts.length > 5 ? ` <span class="tooltip-more">+${arts.length - 5} more</span>` : '';
                connectionsHtml += `<div class="tooltip-conn-group">`;
                connectionsHtml += `<div class="tooltip-conn-type">${label}</div>`;
                for (const a of shown) {
                    connectionsHtml += `<div class="tooltip-conn-ep">${a.title}</div>`;
                }
                if (more) connectionsHtml += `<div class="tooltip-conn-ep">${more}</div>`;
                connectionsHtml += `</div>`;
            }
            connectionsHtml += '</div>';
        }

        this.tooltip.innerHTML = `
            <div class="tooltip-title">${art.title}</div>
            <div class="tooltip-meta">${art.date || ''} &middot; ${art.author || ''}</div>
            <span class="tooltip-domain" style="background:${color}22;color:${color};border:1px solid ${color}44">${domain}</span>
            ${connected.length > 0 ? `<div class="tooltip-count">${connected.length} connection${connected.length !== 1 ? 's' : ''}</div>` : ''}
            ${connectionsHtml}
        `;
        this.tooltip.classList.remove('hidden');
        this.positionTooltip(clientX, clientY);
    }

    positionTooltip(clientX, clientY) {
        const tt = this.tooltip;
        const pad = 12;
        let x = clientX + pad;
        let y = clientY + pad;

        if (x + tt.offsetWidth > window.innerWidth - pad) {
            x = clientX - tt.offsetWidth - pad;
        }
        if (y + tt.offsetHeight > window.innerHeight - pad) {
            y = clientY - tt.offsetHeight - pad;
        }

        tt.style.left = x + 'px';
        tt.style.top = y + 'px';
    }

    hideTooltip() {
        this.tooltip.classList.add('hidden');
    }

    buildLegend() {
        this.legendEl.innerHTML = '';
        for (const [name, group] of Object.entries(DOMAIN_GROUPS)) {
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `<span class="legend-dot" style="background:${group.color}"></span>${name}`;
            item.addEventListener('click', () => {
                this.filterByDomains(group.domains);
            });
            this.legendEl.appendChild(item);
        }
    }

    filterByDomains(domains) {
        if (this.filteredNodeIdxs) {
            this.filteredNodeIdxs = null;
            this.buildGraph([...this.activeConnectionTypes]);
            return;
        }

        const validIdxs = new Set();
        for (const domain of domains) {
            const arts = this.data.articlesByDomain.get(domain) || [];
            for (const idx of arts) validIdxs.add(idx);
        }

        this.filteredNodeIdxs = validIdxs;
        this.applyFilter();
    }

    applyFilter() {
        if (!this.filteredNodeIdxs) {
            this.buildGraph([...this.activeConnectionTypes]);
            return;
        }

        this.nodes = this.data.articles
            .filter(art => this.filteredNodeIdxs.has(art.idx))
            .map(art => ({
                idx: art.idx,
                x: this.width / 2 + (Math.random() - 0.5) * this.width * 0.6,
                y: this.height / 2 + (Math.random() - 0.5) * this.height * 0.6,
                color: art.color,
                article: art,
            }));

        const nodeByIdx = new Map();
        for (const node of this.nodes) {
            nodeByIdx.set(node.idx, node);
        }

        this.links = [];
        for (const conn of this.data.connections) {
            if (!this.activeConnectionTypes.has(conn.type)) continue;
            const source = nodeByIdx.get(conn.source);
            const target = nodeByIdx.get(conn.target);
            if (source && target) {
                this.links.push({
                    source,
                    target,
                    type: conn.type,
                    strength: conn.strength,
                    explanation: conn.explanation,
                });
            }
        }

        this.startSimulation();
    }

    setConnectionTypes(types) {
        this.activeConnectionTypes = new Set(types);
        this.buildGraph([...this.activeConnectionTypes]);
    }

    highlightNode(idx) {
        const node = this.nodes.find(n => n.idx === idx);
        if (node) {
            this.selectedNode = node;

            const targetX = this.width / 2 - node.x * this.transform.k;
            const targetY = this.height / 2 - node.y * this.transform.k;

            d3.select(this.canvas)
                .transition()
                .duration(500)
                .call(this.zoom.transform,
                    d3.zoomIdentity.translate(targetX, targetY).scale(this.transform.k)
                );

            this.draw();
        }
    }

    highlightPath(pathIdxs) {
        this.filteredNodeIdxs = new Set(pathIdxs);
        for (const idx of pathIdxs) {
            const conns = this.data.getConnections(idx);
            for (const conn of conns) {
                if (pathIdxs.includes(conn.source) && pathIdxs.includes(conn.target)) {
                    this.filteredNodeIdxs.add(conn.source);
                    this.filteredNodeIdxs.add(conn.target);
                }
            }
        }
        this.applyFilter();
    }

    clearSelection() {
        this.selectedNode = null;
        this.filteredNodeIdxs = null;
        this.draw();
    }

    setFilter(articleIdxs) {
        if (!articleIdxs) {
            this.filteredNodeIdxs = null;
        } else {
            this.filteredNodeIdxs = new Set(articleIdxs);
        }
        this.applyFilter();
    }
}
