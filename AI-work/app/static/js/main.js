// State Management
let leads = [];
let selectedLeadId = null;
let currentTab = 'audit'; // audit | outreach
let currentOutreachTab = 'email'; // email | whatsapp | linkedin
let activePoller = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
});

function initApp() {
    fetchStats();
    fetchSearchHistory();
    fetchLeads(true); // first load
    
    // Start live polling every 4 seconds to catch background scraper/AI analyzer progress
    startLivePolling();
}

function setupEventListeners() {
    // Search Form Submit
    const searchForm = document.getElementById('search-form');
    if (searchForm) {
        searchForm.addEventListener('submit', handleSearchSubmit);
    }
}

// Start Live Polling
function startLivePolling() {
    if (activePoller) clearInterval(activePoller);
    activePoller = setInterval(() => {
        // Only fetch if there is active background work
        const hasPendingWork = leads.some(l => l.status === 'analyzing') || 
                               document.querySelector('.status-badge.running') ||
                               document.querySelector('.status-badge.pending');
        
        if (hasPendingWork || leads.length === 0) {
            fetchLeads(false);
            fetchStats();
            fetchSearchHistory();
        }
    }, 4000);
}

// Toast Notification System
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'warning') icon = '⚠️';
    if (type === 'error') icon = '🚨';
    
    toast.innerHTML = `
        <span>${icon} &nbsp;${message}</span>
        <span class="toast-close" style="cursor:pointer; opacity:0.6; margin-left:10px;">&times;</span>
    `;
    
    container.appendChild(toast);
    
    // Trigger entry animation
    setTimeout(() => toast.classList.add('show'), 50);
    
    // Auto remove
    const timer = setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
    
    // Manual close
    toast.querySelector('.toast-close').addEventListener('click', () => {
        clearTimeout(timer);
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    });
}

// Fetch stats block
async function fetchStats() {
    try {
        const response = await fetch('/api/stats');
        const stats = await response.json();
        
        document.getElementById('stat-discovered').innerText = stats.total_discovered;
        document.getElementById('stat-analyzed').innerText = stats.total_analyzed;
        document.getElementById('stat-priority').innerText = stats.high_priority;
        document.getElementById('stat-contacted').innerText = stats.contacted;
    } catch (err) {
        console.error('Error fetching stats:', err);
    }
}

// Fetch Search History List
async function fetchSearchHistory() {
    try {
        const response = await fetch('/api/search/history');
        const history = await response.json();
        const historyList = document.getElementById('history-list');
        if (!historyList) return;
        
        if (history.length === 0) {
            historyList.innerHTML = `<div style="text-align:center; padding: 1.5rem; font-size:0.8rem; color:var(--text-muted);">No recent searches.</div>`;
            return;
        }
        
        historyList.innerHTML = history.map(item => {
            const date = new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `
                <div class="history-item">
                    <div class="history-meta">
                        <span class="keyword">${item.keyword}</span>
                        <span class="city">${item.city}</span>
                    </div>
                    <div class="history-details">
                        <span class="status-badge ${item.status}">${item.status}</span>
                        <span class="count">${item.leads_found} found</span>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Error fetching history:', err);
    }
}

// Fetch Leads list
async function fetchLeads(isFirstLoad = false) {
    try {
        const response = await fetch('/api/leads');
        const data = await response.json();
        leads = data;
        
        // Render lead cards
        renderLeadCards();
        
        // Update total counter badge in lead queue header
        document.getElementById('queue-count').innerText = leads.length;
        
        // Auto-select first lead if none selected and it's the first load
        if (isFirstLoad && leads.length > 0 && !selectedLeadId) {
            selectLead(leads[0].id);
        } else if (selectedLeadId) {
            // Keep current lead updated
            updateLeadDetailPanel();
        }
    } catch (err) {
        console.error('Error fetching leads:', err);
        showToast('Failed to load leads list', 'error');
    }
}

// Render the Lead List Cards
function renderLeadCards() {
    const grid = document.getElementById('lead-grid');
    if (!grid) return;
    
    if (leads.length === 0) {
        grid.innerHTML = `
            <div style="text-align:center; padding: 3rem 1.5rem; border: 1px dashed var(--border-glass); border-radius:16px;">
                <svg style="width:48px; height:48px; fill:var(--text-muted); opacity:0.5; margin-bottom:1rem;" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                </svg>
                <p style="font-size:0.9rem; color:var(--text-secondary);">No businesses discovered yet.</p>
                <p style="font-size:0.75rem; color:var(--text-muted); margin-top:0.25rem;">Enter a niche and city on the left sidebar to start hunting!</p>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = leads.map(lead => {
        const isActive = lead.id === selectedLeadId ? 'active' : '';
        
        // Priority calculation badge
        let priorityHtml = '';
        if (lead.opportunity) {
            const score = lead.opportunity.priority_score;
            let pClass = 'low';
            if (score >= 8.5) pClass = 'high';
            else if (score >= 6.5) pClass = 'medium';
            priorityHtml = `<span class="priority-badge ${pClass}">Priority ${score}</span>`;
        }
        
        const ratingHtml = lead.rating ? `
            <span class="chip stars">
                ⭐ ${lead.rating.toFixed(1)} (${lead.reviews_count})
            </span>
        ` : '';
        
        const actionBtn = lead.status === 'discovered' || lead.status === 'crawled' ? `
            <button class="btn-icon analyze-btn" title="Audit Business with AI" onclick="event.stopPropagation(); triggerLeadAnalysis(${lead.id})">
                <svg viewBox="0 0 24 24" style="width:16px; height:16px; fill:currentColor;">
                    <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6C7.8 12.16 7 10.63 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z"/>
                </svg>
            </button>
        ` : '';

        return `
            <div class="lead-card ${isActive}" onclick="selectLead(${lead.id})">
                <div class="lead-header">
                    <div class="lead-name">
                        <h4>${lead.name}</h4>
                        <div class="lead-niche">
                            <span>${lead.niche}</span>
                            <div class="dot-separator"></div>
                            <span>${lead.city}</span>
                        </div>
                    </div>
                    ${priorityHtml}
                </div>
                
                <div class="lead-card-details">
                    ${lead.website ? `
                        <div class="lead-detail-item">
                            <svg viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>
                            <span style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${lead.website.replace('https://', '').replace('http://', '').replace('www.', '')}</span>
                        </div>
                    ` : ''}
                    ${lead.phone ? `
                        <div class="lead-detail-item">
                            <svg viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                            <span>${lead.phone}</span>
                        </div>
                    ` : ''}
                </div>
                
                <div class="lead-footer">
                    <div class="lead-chips">
                        ${ratingHtml}
                    </div>
                    <div class="lead-actions">
                        <span class="lead-crm-status ${lead.status}">${lead.status}</span>
                        ${actionBtn}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Select a single Lead
function selectLead(leadId) {
    selectedLeadId = leadId;
    
    // Update active state in cards visually
    document.querySelectorAll('.lead-card').forEach(card => card.classList.remove('active'));
    
    const cards = document.getElementById('lead-grid').children;
    const leadIndex = leads.findIndex(l => l.id === leadId);
    if (leadIndex !== -1 && cards[leadIndex]) {
        cards[leadIndex].classList.add('active');
    }
    
    updateLeadDetailPanel();
}

// Update the Inspector Panel on the right
function updateLeadDetailPanel() {
    const pane = document.getElementById('inspector-panel');
    if (!pane) return;
    
    const lead = leads.find(l => l.id === selectedLeadId);
    if (!lead) {
        pane.innerHTML = `
            <div class="inspector-placeholder">
                <svg viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                </svg>
                <h3>No Business Selected</h3>
                <p>Select a business lead from the queue list to inspect their automated audit report and custom outreach copy.</p>
            </div>
        `;
        return;
    }
    
    const isAnalyzed = lead.opportunity !== null;
    
    // Determine complexity color class
    const compClass = lead.opportunity ? lead.opportunity.implementation_complexity : 'Low';
    
    let contentHtml = `
        <div class="inspector-card">
            <div class="inspector-header">
                <div class="inspector-title">
                    <h3>${lead.name}</h3>
                    <p style="font-size:0.8rem; color:var(--text-secondary); margin-top:0.25rem;">
                        ${lead.address || 'No address registered.'}
                    </p>
                </div>
                
                <div class="inspector-actions">
                    <button class="btn-outline approve" title="Approve Lead for Outreach" onclick="updateCRMStatus(${lead.id}, 'approved')">
                        👍 Approve
                    </button>
                    <button class="btn-outline contacted-btn" title="Mark Outreach Sent" onclick="updateCRMStatus(${lead.id}, 'contacted')">
                        ✉️ Contacted
                    </button>
                    <button class="btn-outline reject" title="Reject Lead" onclick="updateCRMStatus(${lead.id}, 'rejected')">
                        👎 Reject
                    </button>
                </div>
            </div>
            
            <div class="inspector-grid-info">
                <div class="info-tile">
                    <div class="info-tile-label">Phone Line</div>
                    <div class="info-tile-val">${lead.phone || 'Unknown'}</div>
                </div>
                <div class="info-tile">
                    <div class="info-tile-label">Website</div>
                    <div class="info-tile-val">
                        ${lead.website ? `<a href="${lead.website}" target="_blank" style="color:var(--primary); text-decoration:none;">Open Website ↗</a>` : 'No website listed'}
                    </div>
                </div>
                <div class="info-tile">
                    <div class="info-tile-label">Weekly Time Saved</div>
                    <div class="info-tile-val value-tag">${lead.opportunity ? lead.opportunity.savings_hours : 'Audit Pending'}</div>
                </div>
                <div class="info-tile">
                    <div class="info-tile-label">Est. Value (Month)</div>
                    <div class="info-tile-val value-tag">${lead.opportunity ? lead.opportunity.monthly_value : 'Audit Pending'}</div>
                </div>
                <div class="info-tile">
                    <div class="info-tile-label">Implementation Complexity</div>
                    <div class="info-tile-val complexity-tag ${compClass}">${lead.opportunity ? lead.opportunity.implementation_complexity : 'Audit Pending'}</div>
                </div>
                <div class="info-tile">
                    <div class="info-tile-label">Lead Rating Score</div>
                    <div class="info-tile-val" style="color: #fbbf24; font-weight:700;">
                        ${lead.opportunity ? `⭐ ${lead.opportunity.priority_score.toFixed(1)} / 10` : 'Audit Pending'}
                    </div>
                </div>
            </div>
    `;
    
    if (!isAnalyzed) {
        // Show trigger AI button if not analyzed yet
        const analyzeLabel = lead.status === 'analyzing' ? 'AI Consultant auditing...' : '🔮 Run AI Opportunity Audit';
        const disabledAttr = lead.status === 'analyzing' ? 'disabled' : '';
        
        contentHtml += `
            <div style="text-align:center; padding: 3rem 1.5rem; background:rgba(255,255,255,0.01); border: 1px dashed var(--border-glass); border-radius:12px; margin-top:1rem; display:flex; flex-direction:column; gap:1rem; align-items:center;">
                <p style="font-size:0.9rem; color:var(--text-secondary);">AI Operational Opportunity Audit Pending</p>
                <p style="font-size:0.75rem; color:var(--text-muted); max-width:320px;">Click the button below to crawl this business's website content, analyze repetitive operational workflows, and generate a customized outreach strategy.</p>
                <button class="btn-primary" style="padding: 0.75rem 2rem;" ${disabledAttr} onclick="triggerLeadAnalysis(${lead.id})">
                    ${analyzeLabel}
                </button>
            </div>
        </div>`;
    } else {
        // Show tabs (AI Audit details vs Outreach Drafts)
        const tabAuditActive = currentTab === 'audit' ? 'active' : '';
        const tabOutreachActive = currentTab === 'outreach' ? 'active' : '';
        
        contentHtml += `
            <div class="tab-headers">
                <button class="tab-btn ${tabAuditActive}" onclick="switchTab('audit')">📊 Consultant AI Audit</button>
                <button class="tab-btn ${tabOutreachActive}" onclick="switchTab('outreach')">✉️ Cold Outreach Drafts</button>
            </div>
            
            <!-- Audit Details Tab -->
            <div id="tab-audit-content" class="tab-content ${tabAuditActive}">
                <div class="audit-section">
                    <h4>
                        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                        Operational Repetitive Pain Points
                    </h4>
                    <div class="bullet-list">
                        ${lead.opportunity.pain_points.map(pt => `
                            <div class="bullet-item">
                                <span>✦</span>
                                <div>${pt}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="audit-section">
                    <h4>
                        <svg viewBox="0 0 24 24"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6C7.8 12.16 7 10.63 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z"/></svg>
                        Suggested Custom AI Solutions
                    </h4>
                    <div class="bullet-list">
                        ${lead.opportunity.ai_solutions.map(sol => `
                            <div class="bullet-item sol">
                                <span>★</span>
                                <div>${sol}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
            
            <!-- Outreach Drafts Tab -->
            <div id="tab-outreach-content" class="tab-content ${tabOutreachActive}">
                <div class="sub-tabs">
                    <button class="sub-tab-btn ${currentOutreachTab === 'email' ? 'active' : ''}" onclick="switchOutreachTab('email')">📧 Email Pitch</button>
                    <button class="sub-tab-btn ${currentOutreachTab === 'whatsapp' ? 'active' : ''}" onclick="switchOutreachTab('whatsapp')">💬 WhatsApp Message</button>
                    <button class="sub-tab-btn ${currentOutreachTab === 'linkedin' ? 'active' : ''}" onclick="switchOutreachTab('linkedin')">🔗 LinkedIn DM</button>
                </div>
                
                <div class="outreach-editor">
                    <!-- Email Editor -->
                    <div id="pane-email" class="outreach-pane ${currentOutreachTab === 'email' ? 'active' : ''}">
                        <div class="input-group">
                            <label>Email Subject</label>
                            <input type="text" id="edit-subject" class="draft-input" value="${lead.outreach.email_subject || ''}">
                        </div>
                        <div class="input-group" style="position:relative;">
                            <label>Email Body</label>
                            <span class="copy-badge" id="badge-email">Copied!</span>
                            <textarea id="edit-email-body" class="draft-textarea">${lead.outreach.email_body || ''}</textarea>
                        </div>
                    </div>
                    
                    <!-- WhatsApp Editor -->
                    <div id="pane-whatsapp" class="outreach-pane ${currentOutreachTab === 'whatsapp' ? 'active' : ''}">
                        <div class="input-group" style="position:relative;">
                            <label>WhatsApp Script</label>
                            <span class="copy-badge" id="badge-whatsapp">Copied!</span>
                            <textarea id="edit-whatsapp-body" class="draft-textarea">${lead.outreach.whatsapp_body || ''}</textarea>
                        </div>
                    </div>
                    
                    <!-- LinkedIn Editor -->
                    <div id="pane-linkedin" class="outreach-pane ${currentOutreachTab === 'linkedin' ? 'active' : ''}">
                        <div class="input-group" style="position:relative;">
                            <label>LinkedIn DM Script</label>
                            <span class="copy-badge" id="badge-linkedin">Copied!</span>
                            <textarea id="edit-linkedin-body" class="draft-textarea">${lead.outreach.linkedin_body || ''}</textarea>
                        </div>
                    </div>
                    
                    <div class="editor-footer">
                        <button class="btn-secondary" onclick="copyActiveDraftToClipboard()">📋 Copy Copy</button>
                        <button class="btn-primary" style="padding: 0.6rem 1.5rem;" onclick="saveEditedOutreach(${lead.id})">💾 Save Changes</button>
                    </div>
                </div>
            </div>
        </div>
        `;
    }
    
    pane.innerHTML = contentHtml;
}

// Switch Detail Inspector Tab
function switchTab(tab) {
    currentTab = tab;
    
    // Toggle active classes on tab headers
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.currentTarget.classList.add('active');
    
    // Toggle active content divs
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`tab-${tab}-content`).classList.add('active');
}

// Switch Outreach Platform Tab
function switchOutreachTab(platform) {
    currentOutreachTab = platform;
    
    // Toggle active class on platform pills
    document.querySelectorAll('.sub-tab-btn').forEach(btn => btn.classList.remove('active'));
    event.currentTarget.classList.add('active');
    
    // Toggle active editor panes
    document.querySelectorAll('.outreach-pane').forEach(pane => pane.classList.remove('active'));
    document.getElementById(`pane-${platform}`).classList.add('active');
}

// Handle Google Maps search triggers
async function handleSearchSubmit(e) {
    e.preventDefault();
    
    const nicheInput = document.getElementById('search-niche');
    const cityInput = document.getElementById('search-city');
    const limitInput = document.getElementById('search-limit');
    
    if (!nicheInput || !cityInput) return;
    
    const keyword = nicheInput.value.trim();
    const city = cityInput.value.trim();
    const limit = parseInt(limitInput.value) || 8;
    
    if (!keyword || !city) {
        showToast('Please fill out both niche and city fields', 'warning');
        return;
    }
    
    showToast(`Triggering discovery: '${keyword}' in '${city}'...`, 'info');
    
    try {
        const response = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword, city, limit })
        });
        
        const data = await response.json();
        
        if (data.status === 'enqueued') {
            showToast('Search enqueued in background task!', 'success');
            // Clear inputs
            nicheInput.value = '';
            cityInput.value = '';
            
            // Instantly refresh search query log and stats
            fetchSearchHistory();
            fetchStats();
        } else {
            showToast('Failed to trigger search', 'error');
        }
    } catch (err) {
        console.error('Error triggering search:', err);
        showToast('Connection error triggering search', 'error');
    }
}

// Trigger AI Audit analyze
async function triggerLeadAnalysis(leadId) {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    
    showToast(`Triggering AI Operational Audit for: ${lead.name}`, 'info');
    
    try {
        const response = await fetch(`/api/leads/${leadId}/analyze`, {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.status === 'analyzing') {
            showToast('Analysis worker started in background!', 'success');
            
            // Refresh leads list to show analyzing status
            fetchLeads(false);
            fetchStats();
        } else {
            showToast('Failed to start analysis', 'error');
        }
    } catch (err) {
        console.error('Error starting analysis:', err);
        showToast('Connection error running audit', 'error');
    }
}

// Update CRM statuses (Approved, Contacted, Rejected)
async function updateCRMStatus(leadId, status) {
    try {
        const response = await fetch(`/api/leads/${leadId}/update-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        const data = await response.json();
        
        if (data.status === 'success') {
            showToast(`Lead status updated to: ${status}`, 'success');
            
            // Refresh
            fetchLeads(false);
            fetchStats();
        } else {
            showToast('Failed to update pipeline status', 'error');
        }
    } catch (err) {
        console.error('Error updating status:', err);
        showToast('Connection error updating status', 'error');
    }
}

// Save manually edited outreach
async function saveEditedOutreach(leadId) {
    const editSubjectEl = document.getElementById('edit-subject');
    const editEmailEl = document.getElementById('edit-email-body');
    const editWhatsappEl = document.getElementById('edit-whatsapp-body');
    const editLinkedinEl = document.getElementById('edit-linkedin-body');
    
    const subject = editSubjectEl ? editSubjectEl.value.trim() : '';
    const email = editEmailEl ? editEmailEl.value.trim() : '';
    const whatsapp = editWhatsappEl ? editWhatsappEl.value.trim() : '';
    const linkedin = editLinkedinEl ? editLinkedinEl.value.trim() : '';
    
    try {
        const response = await fetch(`/api/leads/${leadId}/outreach`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email_subject: subject,
                email_body: email,
                whatsapp_body: whatsapp,
                linkedin_body: linkedin
            })
        });
        const data = await response.json();
        
        if (data.status === 'success') {
            showToast('Outreach drafts successfully saved!', 'success');
            // Update local memory representation
            const idx = leads.findIndex(l => l.id === leadId);
            if (idx !== -1 && leads[idx].outreach) {
                leads[idx].outreach.email_subject = subject;
                leads[idx].outreach.email_body = email;
                leads[idx].outreach.whatsapp_body = whatsapp;
                leads[idx].outreach.linkedin_body = linkedin;
            }
        } else {
            showToast('Failed to save drafts', 'error');
        }
    } catch (err) {
        console.error('Error saving outreach edits:', err);
        showToast('Connection error saving edits', 'error');
    }
}

// Copy active draft to clipboard
function copyActiveDraftToClipboard() {
    let copyText = '';
    let badgeId = '';
    
    if (currentOutreachTab === 'email') {
        const textEl = document.getElementById('edit-email-body');
        const subjEl = document.getElementById('edit-subject');
        const subject = subjEl ? subjEl.value : '';
        const body = textEl ? textEl.value : '';
        copyText = subject ? `Subject: ${subject}\n\n${body}` : body;
        badgeId = 'badge-email';
    } else if (currentOutreachTab === 'whatsapp') {
        const textEl = document.getElementById('edit-whatsapp-body');
        copyText = textEl ? textEl.value : '';
        badgeId = 'badge-whatsapp';
    } else if (currentOutreachTab === 'linkedin') {
        const textEl = document.getElementById('edit-linkedin-body');
        copyText = textEl ? textEl.value : '';
        badgeId = 'badge-linkedin';
    }
    
    if (!copyText) {
        showToast('Nothing to copy', 'warning');
        return;
    }
    
    navigator.clipboard.writeText(copyText).then(() => {
        // Show copy badge animation
        const badge = document.getElementById(badgeId);
        if (badge) {
            badge.classList.add('show');
            setTimeout(() => badge.classList.remove('show'), 2000);
        }
        showToast('Outreach copy copied to clipboard!', 'success');
    }).catch(err => {
        console.error('Could not copy text: ', err);
        showToast('Copy to clipboard failed', 'error');
    });
}
