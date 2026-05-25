// JobForge Chrome Extension - Service Worker (background.js)
let socket = null;
let currentCrawlId = 0;
let isCrawlerActive = false;

// Connect to Cloud SaaS WebSocket Gateway
function connectWebSocket() {
  const wsUri = "ws://127.0.0.1:8000/ws/agent";
  console.log(`[JobForge] Connecting to WebSocket gateway: ${wsUri}`);
  
  socket = new WebSocket(wsUri);
  let pingInterval = null;
  
  socket.onopen = () => {
    console.log("[JobForge] WebSocket connection opened successfully.");
    sendLog("IMPORTANT", "[Chrome Extension Client] Handshake successful! Chrome Extension is connected and active.");
    
    // Periodic heartbeat ping every 10 seconds to keep connection alive
    pingInterval = setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "ping" }));
      }
    }, 10000);
  };
  
  socket.onclose = (event) => {
    console.log(`[JobForge] WebSocket connection closed: ${event.reason}. Retrying in 5s...`);
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    socket = null;
    setTimeout(connectWebSocket, 5000);
  };
  
  socket.onerror = (error) => {
    console.error("[JobForge] WebSocket error: ", error);
  };
  
  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      const action = data.action;
      console.log(`[JobForge] Message received: `, data);
      
      if (action === "START_CRAWLER") {
        runCrawler(data.queries, data.locations, data.max_jobs, data.settings);
      } else if (action === "STOP_CRAWLER") {
        stopCrawler();
      } else if (action === "EXECUTE_APPLY") {
        runApplier(data.job, data.settings);
      } else if (action === "CAPTURE_SESSION") {
        sendLog("INFO", "[Session Bridge] Chrome Extension runs inside your active browser natively. Session cookies are automatically inherited! No separate login window capture is needed.");
      }
    } catch (e) {
      console.error("[JobForge] Failed to process message frame: ", e);
    }
  };
}

// Transmit logs down to the SaaS Web UI console
function sendLog(level, message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "log",
      level: level,
      message: message
    }));
  }
}

// Transmit apply results back to SaaS database
function sendApplyResult(success, jobId, jobTitle) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "apply_result",
      success: success,
      job_id: jobId,
      job_title: jobTitle
    }));
  }
}

// ---------------- CRAWLER CONTROLLER ----------------
async function runCrawler(queries, locations, maxJobsPerQuery, settings) {
  if (isCrawlerActive) {
    sendLog("WARNING", "[Crawler] Crawler is already running.");
    return;
  }
  
  isCrawlerActive = true;
  currentCrawlId++;
  const crawlId = currentCrawlId;
  sendLog("INFO", "[Crawler] Starting JobForge Extension Search Engine...");
  
  let totalUploaded = 0;
  
  try {
    for (const location of locations) {
      for (const query of queries) {
        if (!isCrawlerActive || crawlId !== currentCrawlId) break;
        
        let queryJobs = [];
        
        // 1. Crawl Naukri
        sendLog("INFO", `[Crawler] Naukri: Searching for '${query}' in '${location}'...`);
        try {
          const naukriJobs = await scrapeNaukriSearch(query, location, maxJobsPerQuery, settings, crawlId);
          queryJobs = queryJobs.concat(naukriJobs);
        } catch (e) {
          sendLog("ERROR", `[Crawler] Naukri crawl failed: ${e.message}`);
        }
        
        if (!isCrawlerActive || crawlId !== currentCrawlId) break;
        
        // 2. Crawl LinkedIn
        sendLog("INFO", `[Crawler] LinkedIn: Searching for '${query}' in '${location}'...`);
        try {
          const linkedInJobs = await scrapeLinkedInSearch(query, location, maxJobsPerQuery, settings, crawlId);
          queryJobs = queryJobs.concat(linkedInJobs);
        } catch (e) {
          sendLog("ERROR", `[Crawler] LinkedIn crawl failed: ${e.message}`);
        }
        
        // Dynamic Page-by-Page Scraped Job Upload!
        if (queryJobs.length > 0 && isCrawlerActive && crawlId === currentCrawlId) {
          sendLog("INFO", `[Crawler] Dynamic Upload: Batch uploading ${queryJobs.length} newly scraped opportunities to Cloud SaaS...`);
          try {
            const uploadRes = await fetch("http://127.0.0.1:8000/api/jobs/upload", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify(queryJobs)
            });
            const result = await uploadRes.json();
            totalUploaded += queryJobs.length;
            sendLog("IMPORTANT", `[Crawler] Dynamic upload finished! Cloud matches updated. (${totalUploaded} total jobs evaluated)`);
          } catch (uploadErr) {
            sendLog("ERROR", `[Crawler] Dynamic upload network failed: ${uploadErr.message}`);
          }
        }
      }
    }
    
    if (isCrawlerActive && crawlId === currentCrawlId) {
      sendLog("IMPORTANT", `[Crawler] Crawler execution finished! Successfully processed and uploaded ${totalUploaded} jobs to your Kanban dashboard.`);
    }
  } catch (err) {
    sendLog("ERROR", `[Crawler] Scraper process crashed: ${err.message}`);
  } finally {
    isCrawlerActive = false;
  }
}

function stopCrawler() {
  if (isCrawlerActive) {
    isCrawlerActive = false;
    currentCrawlId++;
    sendLog("WARNING", "[Crawler] Scraper abort signal received. Stopping search operations...");
  }
}

// Scrape Naukri search listings
async function scrapeNaukriSearch(query, location, maxJobs, settings, crawlId) {
  const queryEncoded = query.replace(/\s+/g, "-").toLowerCase();
  const locEncoded = location.replace(/\s+/g, "-").toLowerCase();
  const searchUrl = `https://www.naukri.com/${queryEncoded}-jobs-in-${locEncoded}?k=${encodeURIComponent(query)}`;
  
  sendLog("INFO", "[Crawler] Naukri: Opening search tab in foreground...");
  const tab = await createForegroundTab(searchUrl);
  
  // Wait 4 seconds for page and DOM elements to render fully
  await delay(4000);
  
  // Inject listing page crawler
  sendLog("INFO", "[Crawler] Naukri: Injecting listing content script...");
  const cardResults = await injectScriptAndGetResult(tab.id, "content_crawler.js", "crawlNaukriListings", [maxJobs]);
  
  if (!cardResults || cardResults.length === 0) {
    sendLog("WARNING", "[Crawler] Naukri: No job listings card extracted from listings page.");
    chrome.tabs.remove(tab.id);
    return [];
  }
  
  sendLog("INFO", `[Crawler] Naukri: Found ${cardResults.length} listing cards. Fetching descriptions same-origin...`);
  
  const completedJobs = [];
  for (let i = 0; i < cardResults.length; i++) {
    if (!isCrawlerActive || crawlId !== currentCrawlId) break;
    
    const card = cardResults[i];
    sendLog("INFO", `[Crawler] Naukri (${i+1}/${cardResults.length}): Fetching description for '${card.title}' at '${card.company}'...`);
    
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { action: "FETCH_DETAIL", url: card.url }, (res) => {
          if (chrome.runtime.lastError) {
            console.warn("[JobForge] Detail fetch message failed: ", chrome.runtime.lastError.message);
            resolve(null);
          } else {
            resolve(res);
          }
        });
      });
      const fullDesc = response ? response.description : "";
      const isEasyApply = response && response.isEasyApply !== undefined ? response.isEasyApply : true;
      card.description = fullDesc || `Job title: ${card.title}. Company: ${card.company}. Please visit Naukri page for details.`;
      card.is_easy_apply = isEasyApply;
      completedJobs.push(card);
    } catch (e) {
      sendLog("WARNING", `[Crawler] Naukri: Failed to fetch detail JD: ${e.message}`);
      card.description = `Job title: ${card.title}. Company: ${card.company}. Location: ${card.location}.`;
      card.is_easy_apply = true;
      completedJobs.push(card);
    }
    
    await delay(randomInterval(settings.scraping_delay_min || 1, settings.scraping_delay_max || 3));
  }
  
  chrome.tabs.remove(tab.id);
  return completedJobs;
}

// Scrape LinkedIn guest search listings
async function scrapeLinkedInSearch(query, location, maxJobs, settings, crawlId) {
  const queryEncoded = encodeURIComponent(query);
  const locEncoded = encodeURIComponent(location);
  const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${queryEncoded}&location=${locEncoded}`;
  
  sendLog("INFO", "[Crawler] LinkedIn: Opening search tab in background...");
  let tab = await createBackgroundTab(searchUrl);
  let activeTabId = tab.id;
  
  // Wait a bit for LinkedIn to load guest cards
  await delay(3000);
  
  sendLog("INFO", "[Crawler] LinkedIn: Injecting listing content script...");
  let cardResults = await injectScriptAndGetResult(tab.id, "content_crawler.js", "crawlLinkedInListings", [maxJobs]);
  
  // If redirected or guest cards not found standardly, fallback guest API search
  if (!cardResults || cardResults.length === 0) {
    sendLog("WARNING", "[Crawler] LinkedIn: Authwall or standard layout blocked card scraping. Trying public guest search API fallback...");
    chrome.tabs.remove(tab.id);
    
    const guestApiUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${queryEncoded}&location=${locEncoded}&start=0`;
    const fallbackTab = await createBackgroundTab(guestApiUrl);
    activeTabId = fallbackTab.id;
    
    await delay(2000);
    cardResults = await injectScriptAndGetResult(fallbackTab.id, "content_crawler.js", "crawlLinkedInListings", [maxJobs]);
  }
  
  if (!cardResults || cardResults.length === 0) {
    sendLog("WARNING", "[Crawler] LinkedIn: Failed to extract any job listing cards. Public Guest Page blocked.");
    if (activeTabId) chrome.tabs.remove(activeTabId);
    return [];
  }
  
  sendLog("INFO", `[Crawler] LinkedIn: Found ${cardResults.length} listing cards. Fetching descriptions same-origin...`);
  
  const completedJobs = [];
  for (let i = 0; i < cardResults.length; i++) {
    if (!isCrawlerActive || crawlId !== currentCrawlId) break;
    
    const card = cardResults[i];
    sendLog("INFO", `[Crawler] LinkedIn (${i+1}/${cardResults.length}): Fetching description for '${card.title}' at '${card.company}'...`);
    
    try {
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(activeTabId, { action: "FETCH_DETAIL", url: card.url }, (res) => {
          if (chrome.runtime.lastError) {
            console.warn("[JobForge] Detail fetch message failed: ", chrome.runtime.lastError.message);
            resolve(null);
          } else {
            resolve(res);
          }
        });
      });
      const fullDesc = response ? response.description : "";
      const isEasyApply = response && response.isEasyApply !== undefined ? response.isEasyApply : true;
      card.description = fullDesc || `Job title: ${card.title}. Company: ${card.company}. See LinkedIn detail page for full JD.`;
      card.is_easy_apply = isEasyApply;
      completedJobs.push(card);
    } catch (e) {
      sendLog("WARNING", `[Crawler] LinkedIn: Failed to fetch detail JD: ${e.message}`);
      card.description = `Job title: ${card.title}. Company: ${card.company}. Location: ${card.location}.`;
      card.is_easy_apply = true;
      completedJobs.push(card);
    }
    
    await delay(randomInterval(settings.scraping_delay_min || 1, settings.scraping_delay_max || 3));
  }
  
  chrome.tabs.remove(activeTabId);
  return completedJobs;
}

// ---------------- APPLIER CONTROLLER ----------------
async function runApplier(job, settings) {
  // Self-heal relative URLs stored in the SQLite database
  if (job.url && !job.url.startsWith("http")) {
    if (job.platform === "LinkedIn") {
      job.url = "https://www.linkedin.com" + (job.url.startsWith("/") ? "" : "/") + job.url;
    } else if (job.platform === "Naukri") {
      job.url = "https://www.naukri.com" + (job.url.startsWith("/") ? "" : "/") + job.url;
    } else {
      job.url = "https://www.linkedin.com" + (job.url.startsWith("/") ? "" : "/") + job.url;
    }
  }

  sendLog("INFO", `[Applier] Opening active foreground tab to auto-fill: '${job.title}' at '${job.company}'...`);
  
  try {
    // Open job details page in active foreground tab
    const tab = await createForegroundTab(job.url);
    sendLog("INFO", "[Applier] Waiting 4 seconds for page styles and form DOMs to render...");
    await delay(4000);
    
    // Inject applier script
    sendLog("INFO", "[Applier] Injecting DOM Autofill applier script...");
    
    const applySuccess = await new Promise((resolve) => {
      let readyReceived = false;
      
      // Set up a listener for message from content script
      const listener = (msg, sender) => {
        // Ensure message comes from the correct tab to avoid cross-talk
        if (sender.tab && sender.tab.id === tab.id) {
          if (msg.action === "APPLIER_READY") {
            readyReceived = true;
            sendLog("INFO", "[Applier] Content script handshake established. Triggering form filler...");
            chrome.tabs.sendMessage(tab.id, {
              action: "TRIGGER_AUTOFILL",
              job: job,
              settings: settings
            }, (response) => {
              if (chrome.runtime.lastError) {
                sendLog("ERROR", `[Applier] Failed to trigger autofill: ${chrome.runtime.lastError.message}`);
                chrome.runtime.onMessage.removeListener(listener);
                resolve(false);
              }
            });
          } else if (msg.action === "APPLY_FINISHED") {
            chrome.runtime.onMessage.removeListener(listener);
            resolve(msg.success);
          } else if (msg.action === "APPLY_LOG") {
            sendLog(msg.level, msg.message);
          }
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      
      // Inject content_applier.js
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content_applier.js"]
      }, () => {
        if (chrome.runtime.lastError) {
          sendLog("ERROR", `[Applier] Script injection failed: ${chrome.runtime.lastError.message}`);
          chrome.runtime.onMessage.removeListener(listener);
          resolve(false);
          return;
        }
        
        // Backup safety fallback: trigger after 5 seconds if APPLIER_READY didn't arrive
        setTimeout(() => {
          if (!readyReceived) {
            sendLog("WARNING", "[Applier] Readiness handshake signal not received in 5s. Invoking fallback trigger...");
            chrome.tabs.sendMessage(tab.id, {
              action: "TRIGGER_AUTOFILL",
              job: job,
              settings: settings
            }, (response) => {
              if (chrome.runtime.lastError) {
                console.warn("[JobForge] Fallback trigger failed: ", chrome.runtime.lastError.message);
              }
            });
          }
        }, 5000);
      });
    });
    
    if (applySuccess) {
      sendLog("IMPORTANT", `[Applier] Application process completed successfully for job '${job.title}'!`);
      sendApplyResult(true, job.id, job.title);
    } else {
      sendLog("WARNING", `[Applier] Application did not complete successfully or paused in Review mode.`);
      sendApplyResult(false, job.id, job.title);
    }
    
    // Give user a moment to review if tab is active
    setTimeout(() => {
      chrome.tabs.remove(tab.id);
    }, 5000);
    
  } catch (err) {
    sendLog("ERROR", `[Applier] Form-fill application crashed: ${err.message}`);
    sendApplyResult(false, job.id, job.title);
  }
}

// ---------------- HELPERS ----------------
function createBackgroundTab(url) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: url, active: false }, (tab) => {
      resolve(tab);
    });
  });
}

function createForegroundTab(url) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: url, active: true }, (tab) => {
      resolve(tab);
    });
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomInterval(min, max) {
  return Math.floor((Math.random() * (max - min) + min) * 1000);
}

function cleanHtmlText(html) {
  if (!html) return "";
  // Strip tags and trim
  let text = html.replace(/<[^>]*>/g, " ");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

// Inject function call into script
function injectScriptAndGetResult(tabId, file, functionName, args) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: [file]
    }, () => {
      chrome.tabs.sendMessage(tabId, { action: "CALL_FUNCTION", name: functionName, args: args }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[JobForge] Inject script message failed: ", chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(response ? response.result : null);
        }
      });
    });
  });
}

// Initialize
connectWebSocket();

// Listen for keep-alive port connections from the dashboard page
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "jobforge-keepalive") {
    console.log("[JobForge] Keep-alive port channel connected.");
    port.onDisconnect.addListener(() => {
      console.log("[JobForge] Keep-alive port channel disconnected.");
    });
  }
});
