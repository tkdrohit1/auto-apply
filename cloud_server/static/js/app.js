// Application State
let activeTab = 'dashboard';
let jobsData = [];
let currentSelectedJobId = null;
let logSocket = null;
let logPollInterval = null;
let isCrawlerActive = false;

// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
    loadActiveProfileUI(); // Load dynamic profile on startup
    refreshDashboardData();
    initWebSocket();
    initSettingsView();
    
    // Drag-and-drop handlers for Kanban
    setupKanbanScrolls();
});

// Navigation / Tab Changer
function switchTab(tabId) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    
    const activeNav = Array.from(document.querySelectorAll('.nav-item')).find(el => el.getAttribute('onclick').includes(tabId));
    if (activeNav) activeNav.classList.add('active');
    
    const targetTab = document.getElementById(`tab-${tabId}`);
    if (targetTab) targetTab.classList.add('active');
    
    activeTab = tabId;
    
    const titleEl = document.getElementById('page-title');
    const subtitleEl = document.getElementById('page-subtitle');
    
    if (tabId === 'dashboard') {
        titleEl.innerText = 'Dashboard';
        subtitleEl.innerText = 'Intelligent Job Search & Automation Suite';
        refreshDashboardData();
    } else if (tabId === 'kanban') {
        titleEl.innerText = 'Kanban Board';
        subtitleEl.innerText = 'Visual Application Pipeline Tracking';
        loadKanbanBoard();
    } else if (tabId === 'console') {
        titleEl.innerText = 'Automation Engine Console';
        subtitleEl.innerText = 'Real-time Playwright Browser Logs & Execution Status';
        scrollTerminalToBottom();
    } else if (tabId === 'settings') {
        titleEl.innerText = 'Settings Configuration';
        subtitleEl.innerText = 'Manage API Keys, Browser Profiles, and Search Parameters';
        initSettingsView();
    }
}

// Fetch Stats & Matches
function refreshDashboardData() {
    fetch('/api/stats')
        .then(res => res.json())
        .then(data => {
            document.getElementById('stat-scanned').innerText = data.scanned;
            document.getElementById('stat-matches').innerText = data.matches;
            document.getElementById('stat-applied').innerText = data.applied;
            document.getElementById('stat-interviews').innerText = data.interviews;
        })
        .catch(err => console.error("Error loading stats:", err));

    fetch('/api/jobs')
        .then(res => res.json())
        .then(jobs => {
            jobsData = jobs;
            renderJobsList();
            
            if (jobs.length > 0 && !currentSelectedJobId) {
                selectJob(jobs[0].id);
            }
        })
        .catch(err => console.error("Error loading jobs:", err));
}

let activeCategoryFilter = 'strong';
let selectedJobIds = [];

function switchCategoryFilter(category) {
    activeCategoryFilter = category;
    
    // Update active pill UI styling
    document.querySelectorAll('.pill-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.background = '#111827';
        btn.style.color = 'var(--text-muted)';
        btn.style.borderColor = '#374151';
    });
    
    const clickedBtn = Array.from(document.querySelectorAll('.pill-btn')).find(b => b.getAttribute('onclick').includes(category));
    if (clickedBtn) {
        clickedBtn.classList.add('active');
        clickedBtn.style.background = 'rgba(168, 85, 247, 0.15)';
        clickedBtn.style.color = 'var(--primary)';
        clickedBtn.style.borderColor = 'rgba(168, 85, 247, 0.3)';
    }
    
    // Clear selections
    selectedJobIds = [];
    const selectAllCheckbox = document.getElementById('select-all-jobs');
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    updateSelectedCountUI();
    
    renderJobsList();
}

function handleDateFilterChange() {
    const filterVal = document.getElementById('filter-date').value;
    const panel = document.getElementById('custom-date-panel');
    
    if (filterVal === 'custom') {
        panel.style.display = 'flex';
    } else {
        panel.style.display = 'none';
    }
    
    renderJobsList();
}

function resetCustomDateRange() {
    document.getElementById('custom-date-start').value = '';
    document.getElementById('custom-date-end').value = '';
    document.getElementById('filter-date').value = 'all';
    document.getElementById('custom-date-panel').style.display = 'none';
    renderJobsList();
}

function updateSelectedCountUI() {
    const countEl = document.getElementById('selected-jobs-count');
    if (countEl) countEl.innerText = selectedJobIds.length;
}

function toggleJobSelection(jobId, checked) {
    if (checked) {
        if (!selectedJobIds.includes(jobId)) selectedJobIds.push(jobId);
    } else {
        selectedJobIds = selectedJobIds.filter(id => id !== jobId);
    }
    updateSelectedCountUI();
}

function toggleSelectAllJobs(masterCheckbox) {
    selectedJobIds = [];
    const checkboxes = document.querySelectorAll('.job-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = masterCheckbox.checked;
        const jobId = cb.getAttribute('data-job-id');
        if (masterCheckbox.checked) {
            selectedJobIds.push(jobId);
        }
    });
    updateSelectedCountUI();
}

function triggerBulkApply() {
    if (selectedJobIds.length === 0) {
        alert("Please select at least one job to apply.");
        return;
    }
    
    if (!confirm(`Are you sure you want to apply to ${selectedJobIds.length} jobs sequentially one-by-one?`)) {
        return;
    }
    
    switchTab('console');
    appendConsoleLine('INFO', `[System] Sending bulk-apply trigger for ${selectedJobIds.length} queued jobs...`);
    
    fetch('/api/bulk-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_ids: selectedJobIds })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            appendConsoleLine('IMPORTANT', `[System] Bulk-apply queue started! Watching logs sequentially.`);
        } else {
            appendConsoleLine('ERROR', `[System] Bulk-apply failed: ${data.message}`);
        }
        
        // Reset selections
        selectedJobIds = [];
        const selectAllCheckbox = document.getElementById('select-all-jobs');
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
        updateSelectedCountUI();
        refreshDashboardData();
    })
    .catch(err => {
        appendConsoleLine('ERROR', `[System] Bulk-apply request failed: ${err}`);
    });
}

function triggerApplyToAll() {
    // Get all jobs matching the active category filter that have status 'Matches'
    let targetJobs = [];
    if (activeCategoryFilter === 'strong') {
        targetJobs = jobsData.filter(job => job.status === 'Matches' && job.match_score >= 80);
    } else if (activeCategoryFilter === 'fresh') {
        targetJobs = jobsData.filter(job => job.status === 'Matches' && job.match_score < 80);
    } else if (activeCategoryFilter === 'applied') {
        alert("These jobs are already applied!");
        return;
    } else {
        targetJobs = jobsData.filter(job => job.status === 'Matches');
    }
    
    // Filter by platform if active
    const platformFilter = document.getElementById('filter-platform').value;
    if (platformFilter !== 'All') {
        targetJobs = targetJobs.filter(job => job.platform === platformFilter);
    }
    
    if (targetJobs.length === 0) {
        alert("No discovered jobs available in this category to apply.");
        return;
    }
    
    if (!confirm(`Are you sure you want to sequentially apply to ALL ${targetJobs.length} jobs in this category?`)) {
        return;
    }
    
    const jobIdsToApply = targetJobs.map(job => job.id);
    
    switchTab('console');
    appendConsoleLine('INFO', `[System] Sending bulk-apply trigger for ALL ${jobIdsToApply.length} matching jobs...`);
    
    fetch('/api/bulk-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_ids: jobIdsToApply })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            appendConsoleLine('IMPORTANT', `[System] Bulk-apply queue started for ALL ${jobIdsToApply.length} jobs sequentially!`);
        } else {
            appendConsoleLine('ERROR', `[System] Apply to All failed: ${data.message}`);
        }
        
        // Reset selections
        selectedJobIds = [];
        const selectAllCheckbox = document.getElementById('select-all-jobs');
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
        updateSelectedCountUI();
        refreshDashboardData();
    })
    .catch(err => {
        appendConsoleLine('ERROR', `[System] Apply to All request failed: ${err}`);
    });
}

// Render Discovered Job Cards
function renderJobsList() {
    try {
        const container = document.getElementById('job-list-container');
        if (!container) return;
        
        const platformFilter = document.getElementById('filter-platform') ? document.getElementById('filter-platform').value : 'All';
        
        // Helper to parse dates strictly as local midnight
        const parseLocalDate = (dateStr) => {
            if (!dateStr) return new Date(0);
            try {
                const parts = dateStr.substring(0, 10).split('-');
                if (parts.length === 3) {
                    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                }
            } catch (e) {
                console.warn("[JobForge] Failed to parse local date string:", dateStr, e);
            }
            return new Date(dateStr);
        };
        
        // Apply Category Segregation
        let filtered = [];
        if (activeCategoryFilter === 'strong') {
            filtered = jobsData.filter(job => job.status === 'Matches' && job.match_score >= 80);
        } else if (activeCategoryFilter === 'fresh') {
            filtered = jobsData.filter(job => job.status === 'Matches' && job.match_score < 80);
        } else if (activeCategoryFilter === 'applied') {
            filtered = jobsData.filter(job => job.status === 'Applied');
        } else {
            // all: show all scanned jobs except those that are Applied or Closed (keeps dashboard matches 100% clean)
            filtered = jobsData.filter(job => job.status !== 'Applied' && job.status !== 'Closed');
        }
        
        // Apply Platform Filtering
        if (platformFilter !== 'All') {
            filtered = filtered.filter(job => job.platform === platformFilter);
        }
        
        // Apply Date Range Filtering
        const dateFilter = document.getElementById('filter-date') ? document.getElementById('filter-date').value : 'all';
        if (dateFilter !== 'all') {
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            
            if (dateFilter === 'today') {
                filtered = filtered.filter(job => {
                    const jobTime = parseLocalDate(job.created_at || job.updated_at).getTime();
                    return jobTime === todayStart;
                });
            } else if (dateFilter === 'yesterday') {
                const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
                filtered = filtered.filter(job => {
                    const jobTime = parseLocalDate(job.created_at || job.updated_at).getTime();
                    return jobTime === yesterdayStart;
                });
            } else if (dateFilter === 'week') {
                const last7DaysStart = todayStart - 7 * 24 * 60 * 60 * 1000;
                filtered = filtered.filter(job => {
                    const jobTime = parseLocalDate(job.created_at || job.updated_at).getTime();
                    return jobTime >= last7DaysStart;
                });
            } else if (dateFilter === 'custom') {
                const startVal = document.getElementById('custom-date-start') ? document.getElementById('custom-date-start').value : '';
                const endVal = document.getElementById('custom-date-end') ? document.getElementById('custom-date-end').value : '';
                
                if (startVal) {
                    const startTime = parseLocalDate(startVal).getTime();
                    filtered = filtered.filter(job => {
                        const jobTime = parseLocalDate(job.created_at || job.updated_at).getTime();
                        return jobTime >= startTime;
                    });
                }
                if (endVal) {
                    const endTime = parseLocalDate(endVal).getTime();
                    filtered = filtered.filter(job => {
                        const jobTime = parseLocalDate(job.created_at || job.updated_at).getTime();
                        return jobTime <= endTime;
                    });
                }
            }
        }
        
        // Apply Sorting
        const sortDropdown = document.getElementById('sort-jobs');
        const sortBy = sortDropdown ? sortDropdown.value : 'recent';
        if (sortBy === 'recent') {
            filtered.sort((a, b) => {
                const timeA = new Date(a.created_at || a.updated_at || 0).getTime();
                const timeB = new Date(b.created_at || b.updated_at || 0).getTime();
                return timeB - timeA;
            });
        } else {
            filtered.sort((a, b) => b.match_score - a.match_score);
        }
        
        if (filtered.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; color: var(--text-dark); padding: 40px;">
                    <i class="fa-solid fa-briefcase" style="font-size: 40px; margin-bottom: 12px; display: block;"></i>
                    No opportunities matching category "${activeCategoryFilter}".
                </div>
            `;
            const detailPanel = document.getElementById('detail-panel');
            if (detailPanel) detailPanel.style.display = 'none';
            return;
        }
        
        container.innerHTML = filtered.map(job => {
            const badgeClass = job.match_score >= 85 ? 'high' : (job.match_score >= 70 ? 'med' : 'low');
            const isActive = job.id === currentSelectedJobId ? 'active' : '';
            const platformIcon = job.platform === 'LinkedIn' ? 'fa-brands fa-linkedin' : 'fa-solid fa-graduation-cap';
            const platformColor = job.platform === 'LinkedIn' ? '#0a66c2' : '#ff7900';
            const isChecked = selectedJobIds.includes(job.id) ? 'checked' : '';
            
            // Premium status badges
            let statusBadge = '';
            if (job.status === 'Applied') {
                statusBadge = `<span class="match-badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); margin-top: 4px; font-size: 10px; padding: 2px 6px;">Applied</span>`;
            } else if (job.status === 'External') {
                statusBadge = `<span class="match-badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); margin-top: 4px; font-size: 10px; padding: 2px 6px;">External Portal</span>`;
            } else if (job.status === 'Closed') {
                statusBadge = `<span class="match-badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); margin-top: 4px; font-size: 10px; padding: 2px 6px;">Archived</span>`;
            }
            
            return `
                <div class="job-card ${isActive}" onclick="selectJob('${job.id}')">
                    <div class="job-card-header">
                        <div style="display: flex; align-items: flex-start; gap: 8px;">
                            <input type="checkbox" class="job-checkbox" data-job-id="${job.id}" ${isChecked} 
                                   onclick="event.stopPropagation(); toggleJobSelection('${job.id}', this.checked)"
                                   style="accent-color: var(--primary); margin-top: 4px; cursor: pointer; width: 15px; height: 15px;">
                            <div class="job-meta">
                                <h3>${escapeHtml(job.title)}</h3>
                                <p>${escapeHtml(job.company)}</p>
                            </div>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: flex-end;">
                            <div class="match-badge ${badgeClass}">${job.match_score}% Match</div>
                            ${statusBadge}
                        </div>
                    </div>
                    <div class="job-card-details">
                        <span><i class="${platformIcon}" style="color: ${platformColor}"></i> ${job.platform}</span>
                        <span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(job.location || 'Noida')}</span>
                        <span><i class="fa-solid fa-clock"></i> ${formatRelativeDate(job.created_at)}</span>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (err) {
        console.error("[JobForge] Critical crash inside renderJobsList:", err);
    }
}

function filterJobsList() {
    renderJobsList();
}

// Select a job to load in Detail Panel
function selectJob(jobId) {
    currentSelectedJobId = jobId;
    document.querySelectorAll('.job-card').forEach(el => el.classList.remove('active'));
    
    const job = jobsData.find(j => j.id === jobId);
    if (!job) return;
    
    document.getElementById('detail-panel').style.display = 'block';
    document.getElementById('detail-job-title').innerText = job.title;
    document.getElementById('detail-company').innerText = job.company;
    document.getElementById('detail-location').innerText = job.location || 'Noida, India';
    document.getElementById('detail-platform').innerText = job.platform;
    
    const badge = document.getElementById('detail-match-badge');
    badge.innerText = `${job.match_score}% Match`;
    badge.className = 'match-badge ' + (job.match_score >= 85 ? 'high' : (job.match_score >= 70 ? 'med' : 'low'));
    
    document.getElementById('detail-explanation').innerText = job.match_explanation || 'No rationale available.';
    document.getElementById('detail-cover-letter').innerText = job.cover_letter || 'No tailored cover letter generated.';
    document.getElementById('detail-description').innerText = job.description || 'Description not extracted.';
    
    const matchedContainer = document.getElementById('detail-matched-skills');
    const missingContainer = document.getElementById('detail-missing-skills');
    
    matchedContainer.innerHTML = '';
    missingContainer.innerHTML = '';
    
    if (job.matched_skills) {
        job.matched_skills.split(',').forEach(skill => {
            if (skill.trim()) {
                const span = document.createElement('span');
                span.className = 'skill-tag matched';
                span.innerText = skill.trim();
                matchedContainer.appendChild(span);
            }
        });
    }
    if (matchedContainer.innerHTML === '') {
        matchedContainer.innerHTML = '<span style="color: var(--text-dark); font-size: 12px;">None detected.</span>';
    }
    
    if (job.missing_skills) {
        job.missing_skills.split(',').forEach(skill => {
            if (skill.trim()) {
                const span = document.createElement('span');
                span.className = 'skill-tag missing';
                span.innerText = skill.trim();
                missingContainer.appendChild(span);
            }
        });
    }
    if (missingContainer.innerHTML === '') {
        missingContainer.innerHTML = '<span style="color: var(--text-dark); font-size: 12px;">Excellent skill alignment! No gaps.</span>';
    }
}

// Auto Apply Trigger (REST cloud endpoint that sends dynamic WS down to agent!)
function triggerAutoApply() {
    if (!currentSelectedJobId) return;
    
    const applyBtn = document.getElementById('btn-apply-now');
    const originalContent = applyBtn.innerHTML;
    
    applyBtn.disabled = true;
    applyBtn.innerHTML = `<div class="loader"></div> <span>Automating Browser...</span>`;
    
    switchTab('console');
    appendConsoleLine('INFO', `[System] Sending proxy signal to active Local Agent to apply for Job ID: ${currentSelectedJobId}...`);
    
    fetch(`/api/run-applier?job_id=${currentSelectedJobId}`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            applyBtn.disabled = false;
            applyBtn.innerHTML = originalContent;
            
            if (data.success) {
                appendConsoleLine('IMPORTANT', `[System] Automation request successfully queued inside Local Agent!`);
            } else {
                appendConsoleLine('ERROR', `[System] Apply trigger rejected: ${data.message}`);
            }
        })
        .catch(err => {
            applyBtn.disabled = false;
            applyBtn.innerHTML = originalContent;
            appendConsoleLine('ERROR', `[System] API request error: ${err}`);
        });
}

function markJobAsApplied() {
    if (!currentSelectedJobId) return;
    
    fetch(`/api/update-job-status?job_id=${currentSelectedJobId}&status=Applied`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                appendConsoleLine('INFO', `[System] Marked job ${currentSelectedJobId} as Applied.`);
                currentSelectedJobId = null;
                refreshDashboardData();
            }
        });
}

function archiveJobOpportunity() {
    if (!currentSelectedJobId) return;
    
    fetch(`/api/update-job-status?job_id=${currentSelectedJobId}&status=Closed`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                appendConsoleLine('INFO', `[System] Archived job ${currentSelectedJobId}.`);
                currentSelectedJobId = null;
                refreshDashboardData();
            }
        });
}

function copyCoverLetterText() {
    const text = document.getElementById('detail-cover-letter').innerText;
    navigator.clipboard.writeText(text)
        .then(() => {
            alert('Bespoke cover letter copied to clipboard!');
        })
        .catch(err => console.error("Clipboard error:", err));
}

// Kanban Board Pipeline Manager
function loadKanbanBoard() {
    const columns = ['Matches', 'Tailored', 'Applied', 'Interviewing', 'Closed'];
    
    columns.forEach(col => {
        document.getElementById(`col-${col}`).innerHTML = '';
        document.getElementById(`count-${col}`).innerText = '0';
    });
    
    fetch('/api/jobs')
        .then(res => res.json())
        .then(jobs => {
            const counts = { Matches: 0, Tailored: 0, Applied: 0, Interviewing: 0, Closed: 0 };
            
            jobs.forEach(job => {
                const colName = job.status || 'Matches';
                if (!columns.includes(colName)) return;
                
                counts[colName]++;
                
                const card = document.createElement('div');
                card.className = 'kanban-card';
                card.draggable = true;
                card.id = `card-${job.id}`;
                card.setAttribute('ondragstart', `handleDragStart(event, '${job.id}')`);
                
                const scoreClass = job.match_score >= 85 ? 'color: var(--color-success)' : (job.match_score >= 70 ? 'color: var(--color-warning)' : 'color: var(--color-danger)');
                const platformIcon = job.platform === 'LinkedIn' ? 'fa-brands fa-linkedin' : 'fa-solid fa-graduation-cap';
                
                card.innerHTML = `
                    <h5>${escapeHtml(job.title)}</h5>
                    <p>${escapeHtml(job.company)}</p>
                    <div class="kanban-card-footer">
                        <span><i class="${platformIcon}"></i> ${job.platform}</span>
                        <span style="font-weight: 700; ${scoreClass}">${job.match_score}%</span>
                    </div>
                `;
                
                document.getElementById(`col-${colName}`).appendChild(card);
            });
            
            columns.forEach(col => {
                document.getElementById(`count-${col}`).innerText = counts[col];
            });
        });
}

// Drag & Drop
let draggedJobId = null;

function handleDragStart(ev, jobId) {
    draggedJobId = jobId;
    ev.dataTransfer.setData("text", jobId);
}

function allowDrop(ev) {
    ev.preventDefault();
}

function handleDrop(ev, status) {
    ev.preventDefault();
    const jobId = draggedJobId || ev.dataTransfer.getData("text");
    if (!jobId) return;
    
    fetch(`/api/update-job-status?job_id=${jobId}&status=${status}`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                appendConsoleLine('INFO', `[System] Moved job '${jobId}' to status '${status}' via pipeline canvas.`);
                loadKanbanBoard();
            }
        });
        
    draggedJobId = null;
}

function setupKanbanScrolls() {}

// Live Terminal Console Integration
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/ws/logs`;
    
    try {
        logSocket = new WebSocket(wsUrl);
        
        logSocket.onopen = () => {
            appendConsoleLine('INFO', '[System] WebSocket stream successfully bound. Streaming logs live...');
        };
        
        logSocket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            appendConsoleLine(data.level, data.message);
        };
        
        logSocket.onclose = () => {
            console.log("WebSocket connection closed. Initiating backup log polling...");
            initLogPolling();
        };
        
        logSocket.onerror = (err) => {
            console.error("WebSocket error:", err);
        };
    } catch (e) {
        initLogPolling();
    }
}

function initLogPolling() {
    if (logPollInterval) clearInterval(logPollInterval);
    
    appendConsoleLine('WARNING', '[System] WebSocket handshake failed. Operating in backup AJAX polling loop (2000ms latency)...');
    
    let lastLogId = 0;
    logPollInterval = setInterval(() => {
        fetch('/api/logs')
            .then(res => res.json())
            .then(logs => {
                logs.forEach(log => {
                    if (log.id > lastLogId) {
                        appendConsoleLine(log.level, log.message);
                        lastLogId = log.id;
                    }
                });
            })
            .catch(err => console.error("Polling error:", err));
    }, 2000);
}

function appendConsoleLine(level, message) {
    const output = document.getElementById('console-output');
    if (!output) return;
    
    const line = document.createElement('div');
    line.className = `console-line ${level.toLowerCase()}`;
    
    const timestamp = new Date().toLocaleTimeString();
    line.innerHTML = `<span style="color: var(--text-dark)">[${timestamp}]</span> ${escapeHtml(message)}`;
    
    output.appendChild(line);
    scrollTerminalToBottom();
}

function scrollTerminalToBottom() {
    const output = document.getElementById('console-output');
    if (output) {
        output.scrollTop = output.scrollHeight;
    }
}

function clearTerminalLogs() {
    fetch('/api/logs/clear', { method: 'POST' })
        .then(() => {
            const output = document.getElementById('console-output');
            if (output) output.innerHTML = `<div class="console-line info">[System] Log terminal cleared.</div>`;
        });
}

// Crawler Controls
function triggerCrawler() {
    const startBtn = document.getElementById('btn-start-crawler');
    
    if (isCrawlerActive) {
        stopCrawlerEngine();
        return;
    }
    
    switchTab('console');
    isCrawlerActive = true;
    startBtn.innerHTML = `<div class="loader"></div> <span>Searching...</span>`;
    document.getElementById('crawler-status-badge').innerText = 'Scanning';
    document.getElementById('crawler-status-badge').style.color = 'var(--primary)';
    
    fetch('/api/run-crawler', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'started') {
                appendConsoleLine('INFO', '[System] Sync request sent! Dispatched run_crawler to active Desktop Agent.');
            } else {
                appendConsoleLine('WARNING', `[System] Scraper trigger failed: ${data.message}`);
                resetCrawlerButtons();
            }
        })
        .catch(err => {
            appendConsoleLine('ERROR', `[System] API request error starting crawler: ${err}`);
            resetCrawlerButtons();
        });
        
    document.getElementById('btn-stop-crawler').style.display = 'block';
}

function stopCrawlerEngine() {
    fetch('/api/stop-crawler', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            appendConsoleLine('WARNING', '[System] Stop signal sent down to Desktop Agent WebSocket.');
            resetCrawlerButtons();
        });
}

function resetCrawlerButtons() {
    isCrawlerActive = false;
    document.getElementById('btn-start-crawler').innerHTML = `<i class="fa-solid fa-circle-play"></i> <span>Start Search</span>`;
    document.getElementById('crawler-status-badge').innerText = 'Inactive';
    document.getElementById('crawler-status-badge').style.color = 'var(--text-dark)';
    document.getElementById('btn-stop-crawler').style.display = 'none';
}

// Settings View Sync
let currentQueries = [];
let currentLocations = [];

function initSettingsView() {
    fetch('/api/settings')
        .then(res => res.json())
        .then(settings => {
            document.getElementById('settings-use-gemini').checked = settings.use_gemini;
            document.getElementById('settings-gemini-key').value = settings.gemini_api_key || '';
            document.getElementById('settings-gemini-key-fallback').value = settings.gemini_api_key1 || '';
            document.getElementById('settings-openai-key').value = settings.openai_api_key || '';
            
            toggleApiKeysFields();
            
            document.getElementById('settings-review-mode').checked = settings.review_mode;
            document.getElementById('settings-threshold').value = settings.auto_apply_threshold;
            document.getElementById('threshold-val').innerText = settings.auto_apply_threshold;
            document.getElementById('settings-chrome-path').value = settings.chrome_profile_path || '';
            
            currentQueries = settings.search_queries || [];
            currentLocations = settings.locations || [];
            
            renderSettingsBadges();
        });
}

function toggleApiKeysFields() {
    const useGemini = document.getElementById('settings-use-gemini').checked;
    if (useGemini) {
        document.getElementById('group-gemini-key').style.display = 'block';
        document.getElementById('group-openai-key').style.display = 'none';
    } else {
        document.getElementById('group-gemini-key').style.display = 'none';
        document.getElementById('group-openai-key').style.display = 'block';
    }
}

function renderSettingsBadges() {
    const qContainer = document.getElementById('container-search-queries');
    const lContainer = document.getElementById('container-locations');
    
    qContainer.innerHTML = currentQueries.map((q, idx) => `
        <div class="badge-item">
            <span>${escapeHtml(q)}</span>
            <span class="badge-remove" onclick="removeSearchKeyword('query', ${idx})">&times;</span>
        </div>
    `).join('');
    
    lContainer.innerHTML = currentLocations.map((l, idx) => `
        <div class="badge-item" style="background: rgba(6, 182, 212, 0.12); border-color: rgba(6, 182, 212, 0.25)">
            <span>${escapeHtml(l)}</span>
            <span class="badge-remove" onclick="removeSearchKeyword('location', ${idx})">&times;</span>
        </div>
    `).join('');
}

function addSearchKeyword(type) {
    if (type === 'query') {
        const input = document.getElementById('input-new-query');
        const val = input.value.trim();
        if (val && !currentQueries.includes(val)) {
            currentQueries.push(val);
            input.value = '';
            renderSettingsBadges();
        }
    } else if (type === 'location') {
        const input = document.getElementById('input-new-loc');
        const val = input.value.trim();
        if (val && !currentLocations.includes(val)) {
            currentLocations.push(val);
            input.value = '';
            renderSettingsBadges();
        }
    }
}

function removeSearchKeyword(type, index) {
    if (type === 'query') {
        currentQueries.splice(index, 1);
    } else if (type === 'location') {
        currentLocations.splice(index, 1);
    }
    renderSettingsBadges();
}

function saveSettingsToBackend() {
    const settings = {
        use_gemini: document.getElementById('settings-use-gemini').checked,
        gemini_api_key: document.getElementById('settings-gemini-key').value.trim(),
        gemini_api_key1: document.getElementById('settings-gemini-key-fallback').value.trim(),
        openai_api_key: document.getElementById('settings-openai-key').value.trim(),
        review_mode: document.getElementById('settings-review-mode').checked,
        auto_apply_threshold: parseInt(document.getElementById('settings-threshold').value),
        chrome_profile_path: document.getElementById('settings-chrome-path').value.trim(),
        search_queries: currentQueries,
        locations: currentLocations
    };
    
    fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert('Settings successfully persisted!');
            appendConsoleLine('INFO', '[System] Local settings database refreshed.');
            switchTab('dashboard');
        }
    })
    .catch(err => alert('Error saving settings: ' + err));
}

// Active Profile UI Managers
function loadActiveProfileUI() {
    fetch('/api/profiles')
        .then(res => res.json())
        .then(profiles => {
            const dropdown = document.getElementById('settings-active-profile');
            if (dropdown) {
                dropdown.innerHTML = profiles.map(p => `
                    <option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.title)})</option>
                `).join('');
            }
            return fetch('/api/profiles/active');
        })
        .then(res => res.json())
        .then(profile => {
            if (!profile || !profile.name) return;
            
            const dropdown = document.getElementById('settings-active-profile');
            if (dropdown) dropdown.value = profile.id;
            
            const initials = profile.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
            
            document.getElementById('sidebar-user-avatar').innerText = initials;
            document.getElementById('sidebar-user-name').innerText = profile.name;
            document.getElementById('sidebar-user-title').innerText = profile.title;
            
            const settingsAvatar = document.getElementById('settings-profile-avatar');
            if (settingsAvatar) settingsAvatar.innerText = initials;
            
            const settingsName = document.getElementById('settings-profile-name');
            if (settingsName) settingsName.innerText = profile.name;
            
            const settingsTitle = document.getElementById('settings-profile-title');
            if (settingsTitle) settingsTitle.innerText = profile.title;
            
            const settingsSummary = document.getElementById('settings-profile-summary');
            if (settingsSummary) settingsSummary.innerText = profile.summary || 'No summary configured.';
        })
        .catch(err => console.error("Error loading active profile details:", err));
}

function switchActiveProfileBackend() {
    const dropdown = document.getElementById('settings-active-profile');
    if (!dropdown) return;
    const profileId = dropdown.value;
    
    appendConsoleLine('INFO', `[System] Dispatching request to switch active profile to: ${profileId}...`);
    
    fetch(`/api/profiles/active?profile_id=${profileId}`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                appendConsoleLine('IMPORTANT', `[System] Active candidate successfully switched! Now scoring matches for: ${data.profile.name}.`);
                loadActiveProfileUI();
                refreshDashboardData();
            }
        })
        .catch(err => {
            appendConsoleLine('ERROR', `[System] API request error switching active profile: ${err}`);
        });
}

function openSessionCapturer() {
    switchTab('console');
    appendConsoleLine('INFO', '[System] Sending proxy signal to active Local Agent to boot secure session login window...');
    
    fetch('/api/sessions/capture', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'started') {
                appendConsoleLine('INFO', '[System] Capturer request successfully dispatched to Local Agent WebSocket gateway.');
            } else {
                appendConsoleLine('WARNING', `[System] Capturer dispatch failed: ${data.message}`);
            }
        })
        .catch(err => {
            appendConsoleLine('ERROR', `[System] API request error starting capture: ${err}`);
        });
}

// UI Helpers
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
}

function formatRelativeDate(isoString) {
    if (!isoString) return 'Just now';
    try {
        const date = new Date(isoString);
        const diffMs = new Date() - date;
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return 'Just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}h ago`;
        return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
    } catch(e) {
        return 'Recently';
    }
}
