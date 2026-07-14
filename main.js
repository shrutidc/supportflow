document.addEventListener("DOMContentLoaded", () => {
    window.tickets = [];

    // Escape untrusted values before inserting into HTML (ticket content
    // is user-supplied and must never be rendered raw).
    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, ch => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[ch]));
    }

    const savedTheme = localStorage.getItem('themeMode') || 'light';

    // DOM Elements
    const tbody = document.getElementById("ticketTableBody");
    const searchInput = document.getElementById("searchInput");
    const filterBtns = document.querySelectorAll(".filter-btn");

    const metricOpen = document.getElementById("metric-open");
    const metricEscalated = document.getElementById("metric-escalated");

    // State
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get("view");

    let currentSearch = urlParams.get("q") || "";
    let currentStatus = urlParams.get("status") || "All";
    let currentQueue = viewParam || "all";

    // Set page title and active states based on view
    const titleEle = document.getElementById("pageTitle");
    if (titleEle) {
        if (currentQueue === "assigned") titleEle.textContent = "Assigned to Me";
        if (currentQueue === "escalations") titleEle.textContent = "Escalations";
    }

    if (currentQueue === "escalations" && !urlParams.has("status")) {
        currentStatus = "Escalated";
    }

    // Set initial input value
    if (searchInput && currentSearch) {
        searchInput.value = currentSearch;
    }

    // Visually update the filter button
    if (filterBtns) {
        filterBtns.forEach(b => {
            b.classList.remove("active");
            if (b.dataset.status === currentStatus) b.classList.add("active");
        });
    }

    // Removed mock navigation alert since links are now real

    // Sidebar Toggle Logic
    const sidebarToggle = document.getElementById("sidebarToggle");
    if (sidebarToggle) {
        sidebarToggle.addEventListener("click", () => {
            document.documentElement.classList.toggle("sidebar-collapsed");
            localStorage.setItem("sidebarCollapsed", document.documentElement.classList.contains("sidebar-collapsed"));
        });
    }

    // Settings Theme Toggle Logic
    const themeRadios = document.querySelectorAll('input[name="themeMode"]');
    if (themeRadios.length > 0) {
        // Init styling
        themeRadios.forEach(radio => {
            if (radio.id === `theme-${savedTheme}`) radio.checked = true;
            radio.addEventListener("change", (e) => {
                const val = e.target.id.replace('theme-', '');
                if (val === 'dark') {
                    document.documentElement.setAttribute('data-theme', 'dark');
                    localStorage.setItem('themeMode', 'dark');
                } else {
                    document.documentElement.removeAttribute('data-theme');
                    localStorage.setItem('themeMode', 'light');
                }
            });
        });
    }

    async function fetchTickets() {
        if (!tbody) return;

        // Build query string
        const params = new URLSearchParams();
        if (currentStatus !== "All") params.set("status", currentStatus);
        if (currentSearch) params.set("q", currentSearch);
        if (currentQueue === "assigned") params.set("view", "assigned");
        if (currentQueue === "escalations") params.set("view", "escalations");

        try {
            const res = await fetch('/api/tickets?' + params.toString());
            const data = await res.json();
            window.tickets = data.tickets || [];
            updateMetrics();
            renderTable();
        } catch (err) {
            console.error("Failed to fetch tickets", err);
        }
    }

    function updateUrl() {
        const params = new URLSearchParams();
        if (currentStatus !== "All") params.set("status", currentStatus);
        if (currentSearch) params.set("q", currentSearch);
        if (currentQueue !== "all" && currentQueue !== "undefined" && currentQueue) params.set("view", currentQueue);

        const newUrl = window.location.pathname + '?' + params.toString();
        window.history.replaceState({}, '', newUrl);
    }

    // Initial render
    fetchTickets();

    // Setup input listeners
    let searchTimeout;
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            currentSearch = e.target.value;
            updateUrl();
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                fetchTickets();
            }, 300);
        });
    }

    if (filterBtns) {
        filterBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                // Update active styling
                filterBtns.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                // Update state and re-render
                currentStatus = btn.dataset.status;
                updateUrl();
                fetchTickets();
            });
        });
    }

    function updateMetrics() {
        let openCount = 0;
        let escalatedCount = 0;

        window.tickets.forEach(t => {
            if (t.status === "New" || t.status === "In Progress") {
                openCount++;
            }
            if (t.status === "Escalated") {
                escalatedCount++;
            }
        });

        const grid = document.querySelector(".metrics-grid");
        if (grid) {
            grid.innerHTML = `
                <div class="metric-card"><div class="metric-title">Open Tickets</div><div class="metric-value" id="metric-open">${openCount}</div></div>
                <div class="metric-card"><div class="metric-title">Escalated</div><div class="metric-value" id="metric-escalated" style="color: var(--status-escalated);">${escalatedCount}</div></div>
                <div class="metric-card"><div class="metric-title">Avg Response Time</div><div class="metric-value">1.4h</div></div>
                <div class="metric-card"><div class="metric-title">Customer Satisfaction</div><div class="metric-value">98%</div></div>
            `;
        }
    }

    function formatDate(isoString) {
        const date = new Date(isoString);
        return date.toLocaleDateString("en-US", { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function renderTable() {
        const filtered = window.tickets;

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 48px;">
                        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: var(--bg-secondary); padding: 32px; border-radius: 8px; border: 1px solid var(--border-color);">
                            <h3 style="margin: 0; color: var(--text-primary);">No tickets found</h3>
                            <p style="margin: 0; color: var(--text-secondary);">Try adjusting your filters.</p>
                            <button class="btn btn-primary" id="clearFiltersBtn" style="margin-top: 8px;">Clear filters</button>
                        </div>
                    </td>
                </tr>
            `;
            setTimeout(() => {
                const clearBtn = document.getElementById("clearFiltersBtn");
                if (clearBtn) {
                    clearBtn.addEventListener("click", clearFilters);
                }
            }, 0);
            return;
        }

        tbody.innerHTML = filtered.map(t => {
            const statusClass = `badge-status-${escapeHtml(t.status.replace(/ /g, '-'))}`;
            const priorityClass = `badge-priority-${escapeHtml(t.priority)}`;

            // Style closed tickets as muted row entirely? The prompt says "visually styled as muted" for Closed state.
            const rowStyle = t.status === "Closed" ? 'style="opacity: 0.6;"' : '';

            return `
                <tr data-ticket-id="${escapeHtml(t.ticketId)}" ${rowStyle}>
                    <td class="font-medium">${escapeHtml(t.ticketId)}</td>
                    <td>
                        <div class="font-medium">${escapeHtml(t.customer.name)}</div>
                        <div class="text-sm text-secondary">${escapeHtml(t.customer.company || "—")}</div>
                    </td>
                    <td>${escapeHtml(t.subject)}</td>
                    <td><div class="text-sm">${escapeHtml(t.assignedTo ? t.assignedTo : "Unassigned")}</div></td>
                    <td><span class="badge ${priorityClass}">${escapeHtml(t.priority)}</span></td>
                    <td><span class="badge ${statusClass}">${escapeHtml(t.status)}</span></td>
                    <td style="text-align: right" class="text-secondary">${formatDate(t.lastUpdated)}</td>
                </tr>
            `;
        }).join("");
    }

    // Delegated row navigation (replaces per-row inline onclick handlers).
    if (tbody) {
        tbody.addEventListener("click", (e) => {
            const row = e.target.closest("tr[data-ticket-id]");
            if (!row) return;
            const fromParam = encodeURIComponent(window.location.search);
            window.location.href = `ticket.html?id=${encodeURIComponent(row.dataset.ticketId)}&from=${fromParam}`;
        });
    }

    function clearFilters() {
        if (searchInput) {
            searchInput.value = "";
            currentSearch = "";
        }
        currentStatus = "All";
        if (filterBtns) {
            filterBtns.forEach(b => {
                b.classList.remove("active");
                if (b.dataset.status === "All") b.classList.add("active");
            });
        }

        // Reset queue to view default
        if (viewParam === "assigned") currentQueue = "assigned";
        else if (viewParam === "escalations") {
            currentQueue = "escalations";
            currentStatus = "Escalated";
            if (filterBtns) {
                filterBtns.forEach(b => {
                    b.classList.remove("active");
                    if (b.dataset.status === "Escalated") b.classList.add("active");
                });
            }
        } else {
            currentQueue = "all";
        }

        updateUrl();
        fetchTickets();
    }

    // --- Client-Side Routing for index.html views ---
    const isIndexPage = window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/');
    if (isIndexPage) {
        const indexNavs = document.querySelectorAll('a.nav-item[href^="index.html"]');
        indexNavs.forEach(nav => {
            nav.addEventListener('click', (e) => {
                e.preventDefault();
                const targetHref = nav.getAttribute('href');
                window.history.pushState({}, '', targetHref);

                // Parse new view
                const newParams = new URLSearchParams(targetHref.split('?')[1] || "");
                const newView = newParams.get('view');

                // Update state
                if (newView === 'assigned') currentQueue = 'assigned';
                else if (newView === 'escalations') currentQueue = 'escalations';
                else currentQueue = 'all';

                // Update UI active navs
                document.querySelectorAll('.sidebar-nav .nav-item').forEach(n => n.classList.remove('active'));
                nav.classList.add('active');

                // Update title, status, filters
                updateViewState();
            });
        });

        window.addEventListener('popstate', () => {
            const newParams = new URLSearchParams(window.location.search);
            const newView = newParams.get('view');

            if (newView === 'assigned') currentQueue = 'assigned';
            else if (newView === 'escalations') currentQueue = 'escalations';
            else currentQueue = 'all';

            // update active nav visually
            document.querySelectorAll('.sidebar-nav .nav-item').forEach(n => n.classList.remove('active'));
            if (currentQueue === 'assigned') {
                const n = document.getElementById('nav-assigned');
                if (n) n.classList.add('active');
            } else if (currentQueue === 'escalations') {
                const n = document.querySelector('a.nav-item[href="index.html?view=escalations"]');
                if (n) n.classList.add('active');
            } else {
                const n = document.getElementById('nav-tickets');
                if (n) n.classList.add('active');
            }

            updateViewState();
        });

        function updateViewState() {
            const titleEle = document.getElementById("pageTitle");
            if (titleEle) {
                if (currentQueue === "assigned") titleEle.textContent = "Assigned to Me";
                else if (currentQueue === "escalations") titleEle.textContent = "Escalations";
                else titleEle.textContent = "Tickets";
            }

            if (currentQueue === "escalations") currentStatus = "Escalated";
            else currentStatus = "All"; // default for others

            if (filterBtns) {
                filterBtns.forEach(b => {
                    b.classList.remove("active");
                    if (b.dataset.status === currentStatus) b.classList.add("active");
                });
            }

            if (searchInput) {
                searchInput.value = "";
                currentSearch = "";
            }

            updateUrl();
            fetchTickets();
        }
    }
});
