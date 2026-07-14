document.addEventListener("DOMContentLoaded", async () => {
    const contentArea = document.getElementById("ticketContent");

    // Escape untrusted values before inserting into HTML (ticket content
    // is user-supplied and must never be rendered raw).
    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, ch => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[ch]));
    }

    // Extract ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const ticketId = urlParams.get("id");

    if (!ticketId) {
        renderNotFound();
        return;
    }

    // Helper to show toasts
    function showToast(message, type = 'success') {
        const toast = document.createElement("div");
        toast.style.position = "fixed";
        toast.style.bottom = "24px";
        toast.style.right = "24px";
        toast.style.padding = "12px 24px";
        toast.style.background = type === 'error' ? "var(--status-closed)" : "var(--status-new)";
        toast.style.color = "white";
        toast.style.borderRadius = "6px";
        toast.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
        toast.style.zIndex = "1000";
        toast.style.fontWeight = "500";
        toast.style.transition = "opacity 0.3s ease";
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = "0";
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Handle Back Button
    const btnBack = document.getElementById("btnBackToQueue");
    if (btnBack) {
        btnBack.addEventListener("click", () => {
            const fromParam = urlParams.get("from");
            if (fromParam) {
                // Determine if fromParam already has query params
                const base = 'index.html';
                window.location.href = base + decodeURIComponent(fromParam);
            } else if (document.referrer && document.referrer.includes('index.html')) {
                window.location.href = document.referrer;
            } else {
                window.location.href = 'index.html';
            }
        });
    }

    await loadTicket();

    async function loadTicket() {
        try {
            const res = await fetch(`/api/tickets/${ticketId}`);
            if (!res.ok) {
                renderNotFound();
                return;
            }
            const ticket = await res.json();
            renderTicket(ticket);
        } catch (err) {
            console.error("Error loading ticket:", err);
            renderNotFound();
        }
    }

    function formatDate(isoString) {
        const date = new Date(isoString);
        return date.toLocaleDateString("en-US", { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function renderNotFound() {
        contentArea.innerHTML = `
            <div style="text-align: center; padding: 64px 20px;">
                <h2 style="color: var(--text-primary); margin-bottom: 8px;">Ticket not found</h2>
                <p style="color: var(--text-secondary); margin-bottom: 16px;">The ticket ID you requested does not exist or has been removed.</p>
                <button class="btn btn-primary" onclick="window.location.href='index.html'">Return to Dashboard</button>
            </div>
        `;
    }

    function renderTicket(t) {
        const statusClass = `badge-status-${escapeHtml(t.status.replace(/ /g, '-'))}`;
        const priorityClass = `badge-priority-${escapeHtml(t.priority)}`;

        let messagesHtml = t.messages.map(msg => {
            const isCustomer = msg.sender === "customer";
            const alignClass = isCustomer ? "customer" : "agent";
            const senderName = isCustomer ? t.customer.name : t.assignedTo || "Agent";
            return `
                <div class="message ${alignClass}">
                    <div class="message-meta">${escapeHtml(senderName)} &bull; ${formatDate(msg.timestamp)}</div>
                    <div class="message-bubble">${escapeHtml(msg.body)}</div>
                </div>
            `;
        }).join("");

        const canClaim = !t.assignedTo && t.status !== 'Closed' && t.status !== 'Escalated';

        contentArea.innerHTML = `
            <!-- Ticket Header -->
            <div class="ticket-header">
                <div class="ticket-header-left">
                    <h1 style="margin-bottom: 4px;">${escapeHtml(t.subject)}</h1>
                    <div class="ticket-meta-row">
                        <span class="text-secondary font-medium">${escapeHtml(t.ticketId)}</span>
                        <span class="badge ${priorityClass}">${escapeHtml(t.priority)}</span>
                        ${canClaim ? `<button id="btnClaimTicket" class="btn btn-primary" style="padding: 4px 8px; font-size: 12px; margin-left: 8px;">Claim Ticket</button>` : ''}
                    </div>
                </div>
                <div>
                    <!-- Visual dropdown for status -->
                    <select id="statusSelect" class="search-input" style="width: 140px; padding: 6px 12px;">
                        <option ${t.status === 'New' ? 'selected' : ''}>New</option>
                        <option ${t.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                        <option ${t.status === 'Escalated' ? 'selected' : ''}>Escalated</option>
                        <option ${t.status === 'Closed' ? 'selected' : ''}>Closed</option>
                    </select>
                </div>
            </div>

            <!-- Ticket Layout -->
            <div class="ticket-layout">
                <!-- Left: Conversation (70%) -->
                <div class="ticket-main">
                    <div class="conversation">
                        <div class="messages-area">
                            ${messagesHtml}
                        </div>
                        
                        <!-- Reply Composer -->
                        <div class="composer">
                            <textarea id="replyBody" placeholder="Type your reply to ${escapeHtml(t.customer.name)}..."></textarea>
                            <div class="composer-actions">
                                <button id="btnSendReply" class="btn btn-primary">Send Reply</button>
                                <button id="btnInternalNote" class="btn btn-secondary">Add Internal Note</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Right: Info Panel (30%) -->
                <div class="ticket-sidebar">
                    <!-- Customer Details -->
                    <div class="info-card">
                        <div class="info-card-header">Customer Details</div>
                        <div class="info-list">
                            <div class="info-item">
                                <span class="info-label">Name</span>
                                <span class="info-value">${escapeHtml(t.customer.name)}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Company</span>
                                <span class="info-value">${escapeHtml(t.customer.company)}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Email</span>
                                <span class="info-value"><a href="mailto:${escapeHtml(t.customer.email)}" style="color: var(--accent-color); text-decoration: none;">${escapeHtml(t.customer.email)}</a></span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Phone</span>
                                <span class="info-value">${escapeHtml(t.customer.phone)}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Ticket Metadata -->
                    <div class="info-card">
                        <div class="info-card-header">Ticket Attributes</div>
                        <div class="info-list">
                            <div class="info-item">
                                <span class="info-label">Category</span>
                                <div style="margin-top: 4px;"><span class="chip">${escapeHtml(t.category)}</span></div>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Assigned To</span>
                                <span class="info-value">${escapeHtml(t.assignedTo || "Unassigned")}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Created</span>
                                <span class="info-value">${formatDate(t.createdAt)}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">SLA Deadline</span>
                                <span class="info-value" style="color: var(--priority-high); font-weight: 600;">${formatDate(t.slaDeadline)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Attach event listeners
        document.getElementById("statusSelect").addEventListener("change", async (e) => {
            const newStatus = e.target.value;
            try {
                await fetch(`/api/tickets/${ticketId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: newStatus })
                });
                loadTicket(); // Refresh
            } catch (err) {
                console.error("Failed to update status", err);
            }
        });

        const btnClaim = document.getElementById("btnClaimTicket");
        if (btnClaim) {
            btnClaim.addEventListener("click", async () => {
                // Loading state
                btnClaim.disabled = true;
                const originalText = btnClaim.textContent;
                btnClaim.textContent = "Claiming...";

                try {
                    const res = await fetch(`/api/tickets/${ticketId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ assignedTo: "You", status: "In Progress" })
                    });

                    if (!res.ok) {
                        if (res.status === 409) {
                            showToast("Ticket is already assigned to someone else.", "error");
                        } else {
                            showToast("Failed to claim ticket.", "error");
                        }
                        btnClaim.disabled = false;
                        btnClaim.textContent = originalText;
                        loadTicket(); // Refresh to get current state
                        return;
                    }

                    showToast("Ticket successfully claimed!", "success");
                    loadTicket(); // Refresh
                } catch (err) {
                    console.error("Failed to claim ticket", err);
                    showToast("Network error. Could not claim.", "error");
                    btnClaim.disabled = false;
                    btnClaim.textContent = originalText;
                }
            });
        }

        async function sendMessage(body) {
            if (!body.trim()) return;
            try {
                await fetch(`/api/tickets/${ticketId}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sender: 'agent', body })
                });
                loadTicket(); // Refresh to show new message
            } catch (err) {
                console.error("Failed to send message", err);
            }
        }

        document.getElementById("btnSendReply").addEventListener("click", () => {
            const body = document.getElementById("replyBody").value;
            sendMessage(body);
        });

        document.getElementById("btnInternalNote").addEventListener("click", () => {
            const body = "[Internal Note] " + document.getElementById("replyBody").value;
            sendMessage(body);
        });
    }
});
