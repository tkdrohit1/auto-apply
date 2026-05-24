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
    // Deactivate previous
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    
    // Activate current
    const activeNav = Array.from(document.querySelectorAll('.nav-item')).find(el => el.getAttribute('onclick').includes(tabId));
    if (activeNav) activeNav.classList.add('active');
    
    const targetTab = document.getElementById(`tab-${tabId}`);
    if (targetTab) targetTab.classList.add('active');
    
    activeTab = tabId;
    
    // Update headers
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
            
            // Auto-select first job if none selected
            if (jobs.length > 0 && !currentSelectedJobId) {
                selectJob(jobs[0].id);
            }
        })
        .catch(err => console.error("Error loading jobs:", err));
}

// Render Discovered Job Cards
function renderJobsList() {
    const container = document.getElementById('job-list-container');
    const platformFilter = document.getElementById('filter-platform').value;
    
    // Filter
    let filtered = jobsData.filter(job => job.status === 'Matches');
    if (platformFilter !== 'All') {
        filtered = filtered.filter(job => job.platform === platformFilter);
    }
    
    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-dark); padding: 40px;">
                <i class="fa-solid fa-briefcase" style="font-size: 40px; margin-bottom: 12px; display: block;"></i>
                No matching jobs found. Click "Start Search" above!
            </div>
        `;
        document.getElementById('detail-panel').style.display = 'none';
        return;
    }
    
    container.innerHTML = filtered.map(job => {
        const badgeClass = job.match_score >= 85 ? 'high' : (job.match_score >= 70 ? 'med' : 'low');
        const isActive = job.id === currentSelectedJobId ? 'active' : '';
        const platformIcon = job.platform === 'LinkedIn' ? 'fa-brands fa-linkedin' : 'fa-solid fa-graduation-cap';
        const platformColor = job.platform === 'LinkedIn' ? '#0a66c2' : '#ff7900';
        
        return `
            <div class="job-card ${isActive}" onclick="selectJob('${job.id}')">
                <div class="job-card-header">
                    <div class="job-meta">
                        <h3>${escapeHtml(job.title)}</h3>
                        <p>${escapeHtml(job.company)}</p>
                    </div>
                    <div class="match-badge ${badgeClass}">${job.match_score}% Match</div>
                </div>
                <div class="job-card-details">
                    <span><i class="${platformIcon}" style="color: ${platformColor}"></i> ${job.platform}</span>
                    <span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(job.location || 'Noida')}</span>
                    <span><i class="fa-solid fa-clock"></i> ${formatRelativeDate(job.created_at)}</span>
                </div>
            </div>
        `;
    }).join('');
}

function filterJobsList() {
    renderJobsList();
}

// Select a job to load in Detail Pane
function selectJob(jobId) {
    currentSelectedJobId = jobId;
    
    // Highlight active card
    document.querySelectorAll('.job-card').forEach(el => el.classList.remove('active'));
    
    const job = jobsData.find(j => j.id === jobId);
    if (!job) return;
    
    // Display detail panel
    document.getElementById('detail-panel').style.display = 'block';
    
    // Populate simple texts
    document.getElementById('detail-job-title').innerText = job.title;
    document.getElementById('detail-company').innerText = job.company;
    document.getElementById('detail-location').innerText = job.location || 'Noida, India';
    document.getElementById('detail-platform').innerText = job.platform;
    
    // Match score badge
    const badge = document.getElementById('detail-match-badge');
    badge.innerText = `${job.match_score}% Match`;
    badge.className = 'match-badge ' + (job.match_score >= 85 ? 'high' : (job.match_score >= 70 ? 'med' : 'low'));
    
    // AI Explanation
    document.getElementById('detail-explanation').innerText = job.match_explanation || 'No rationale available.';
    
    // Cover Letter
    document.getElementById('detail-cover-letter').innerText = job.cover_letter || 'No tailored cover letter generated.';
    
    // Description
    document.getElementById('detail-description').innerText = job.description || 'Description not extracted.';
    
    // Populate skills tags
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
    
    // Update active highlight class in list view
    const cards = document.querySelectorAll('.job-card');
    cards.forEach(card => {
        if (card.innerHTML.includes(escapeHtml(job.title)) && card.innerHTML.includes(escapeHtml(job.company))) {
            card.classList.add('active');
        }
    });
}

// Auto Apply Trigger
function triggerAutoApply() {
    if (!currentSelectedJobId) return;
    
    const applyBtn = document.getElementById('btn-apply-now');
    const originalContent = applyBtn.innerHTML;
    
    applyBtn.disabled = true;
    applyBtn.innerHTML = `<div class="loader"></div> <span>Automating Browser...</span>`;
    
    // Auto-switch to terminal logs so they can watch Playwright do its thing!
    switchTab('console');
    appendConsoleLine('INFO', `[System] Dispatching Playwright browser worker to automate application for Job ID: ${currentSelectedJobId}...`);
    
    fetch(`/api/run-applier?job_id=${currentSelectedJobId}`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            applyBtn.disabled = false;
            applyBtn.innerHTML = originalContent;
            
            if (data.success) {
                appendConsoleLine('IMPORTANT', `[System] Automation finished! Application successfully submitted or review completed.`);
                refreshDashboardData();
            } else {
                appendConsoleLine('ERROR', `[System] Application automation failed or halted: ${data.message}`);
            }
        })
        .catch(err => {
            applyBtn.disabled = false;
            applyBtn.innerHTML = originalContent;
            appendConsoleLine('ERROR', `[System] API request error starting applier: ${err}`);
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
    
    // Clear all
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
            
            // Set counts
            columns.forEach(col => {
                document.getElementById(`count-${col}`).innerText = counts[col];
            });
        });
}

// Drag & Drop mechanic
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

function setupKanbanScrolls() {
    // Prevents text selection on drags
}

// Live Terminal Console Integration
function initWebSocket() {
    // Attempt WebSocket handshake
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
            console.error("WebSocket encountered an error:", err);
        };
    } catch (e) {
        initLogPolling();
    }
}

// Backup Polling if WebSocket falls down
function initLogPolling() {
    if (logPollInterval) clearInterval(logPollInterval);
    
    appendConsoleLine('WARNING', '[System] WebSocket handshake failed. Operating in backup AJAX polling loop (2000ms latency)...');
    
    let lastLogId = 0;
    logPollInterval = setInterval(() => {
        fetch('/api/logs')
            .then(res => res.json())
            .then(logs => {
                // Filter new logs
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
    
    // Auto-scroll
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
    
    // Make API request to spawn background thread crawler
    fetch('/api/run-crawler', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'started') {
                appendConsoleLine('INFO', '[System] Background search job spawned. Searching LinkedIn & Naukri...');
            } else {
                appendConsoleLine('WARNING', `[System] Job failed to trigger: ${data.message}`);
                resetCrawlerButtons();
            }
        })
        .catch(err => {
            appendConsoleLine('ERROR', `[System] Error triggering crawler: ${err}`);
            resetCrawlerButtons();
        });
        
    // Show stop button in console tab
    document.getElementById('btn-stop-crawler').style.display = 'block';
}

function stopCrawlerEngine() {
    fetch('/api/stop-crawler', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            appendConsoleLine('WARNING', '[System] Abort request dispatched. Waiting for browser shutdown sequence...');
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

// Active Profile UI Managers
function loadActiveProfileUI() {
    // 1. Fetch available profiles for Settings dropdown
    fetch('/api/profiles')
        .then(res => res.json())
        .then(profiles => {
            const dropdown = document.getElementById('settings-active-profile');
            if (dropdown) {
                dropdown.innerHTML = profiles.map(p => `
                    <option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.title)})</option>
                `).join('');
            }
            
            // 2. Fetch actively loaded profile
            return fetch('/api/profiles/active');
        })
        .then(res => res.json())
        .then(profile => {
            if (!profile || !profile.name) return;
            
            // Sync dropdown value
            const dropdown = document.getElementById('settings-active-profile');
            if (dropdown) dropdown.value = profile.id;
            
            // Extract Initials
            const initials = profile.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
            
            // Update Sidebar Footer
            document.getElementById('sidebar-user-avatar').innerText = initials;
            document.getElementById('sidebar-user-name').innerText = profile.name;
            document.getElementById('sidebar-user-title').innerText = profile.title;
            
            // Update Settings Banner Card
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
                
                // Update active profile UI variables
                loadActiveProfileUI();
                
                // Refresh dashboard stats & matches feed
                refreshDashboardData();
            }
        })
        .catch(err => {
            appendConsoleLine('ERROR', `[System] API request error switching active profile: ${err}`);
        });
}

function openSessionCapturer() {
    switchTab('console');
    appendConsoleLine('INFO', '[System] Dispatching request to start secure headed session capturer...');
    
    fetch('/api/sessions/capture', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'started') {
                appendConsoleLine('INFO', '[System] Secure browser spawned successfully! Complete logins and close the window.');
            } else {
                appendConsoleLine('WARNING', `[System] Capture failed to trigger: ${data.message}`);
            }
        })
        .catch(err => {
            appendConsoleLine('ERROR', `[System] API request error starting capture: ${err}`);
        });
}

// Settings View Sync
let currentQueries = [];
let currentLocations = [];

function initSettingsView() {
    fetch('/api/settings')
        .then(res => res.json())
        .then(settings => {
            // Populate keys
            document.getElementById('settings-use-gemini').checked = settings.use_gemini;
            document.getElementById('settings-gemini-key').value = settings.gemini_api_key || '';
            document.getElementById('settings-gemini-key-fallback').value = settings.gemini_api_key1 || '';
            document.getElementById('settings-openai-key').value = settings.openai_api_key || '';
            
            toggleApiKeysFields();
            
            // Mode & Threshold
            document.getElementById('settings-review-mode').checked = settings.review_mode;
            document.getElementById('settings-threshold').value = settings.auto_apply_threshold;
            document.getElementById('threshold-val').innerText = settings.auto_apply_threshold;
            
            // Path
            document.getElementById('settings-chrome-path').value = settings.chrome_profile_path || '';
            
            // Keywords
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
