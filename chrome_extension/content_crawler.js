// JobForge Chrome Extension - Listings Content Scraper & Same-Origin Fetcher (content_crawler.js)

function cleanText(text) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

function cleanHtmlText(html) {
  if (!html) return "";
  let text = html.replace(/<[^>]*>/g, " ");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

// Helper to wait for DOM elements to exist asynchronously (up to 10 seconds)
async function waitForSelectors(selectorString, maxWaitMs = 10000) {
  console.log(`[JobForge Crawler] Waiting for selector: ${selectorString}...`);
  const interval = 500;
  let elapsed = 0;
  while (elapsed < maxWaitMs) {
    const elements = document.querySelectorAll(selectorString);
    if (elements.length > 0) {
      console.log(`[JobForge Crawler] Selector matched! Found ${elements.length} elements after ${elapsed / 1000}s.`);
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
    elapsed += interval;
  }
  console.warn(`[JobForge Crawler] Timeout waiting for selector: ${selectorString} on page: ${window.location.href} (Title: ${document.title})`);
  return false;
}

// ---------------- SAME-ORIGIN DETAILED JD FETCH ----------------
async function fetchNaukriOrLinkedInDetail(url) {
  console.log(`[JobForge Crawler] In-page same-origin fetch for URL: ${url}`);
  try {
    const res = await fetch(url);
    const html = await res.text();
    
    let description = "";
    let isEasyApply = true;
    
    // Scrape description text using DOMParser selectors or regex match
    if (url.includes("naukri.com")) {
      const descRegex = /<section class="job-desc">([\s\S]*?)<\/section>/i;
      const match = html.match(descRegex);
      if (match) {
        description = cleanHtmlText(match[1]);
      } else {
        const pMatches = [...html.matchAll(/<p class="dang-art-html">([\s\S]*?)<\/p>/gi)];
        if (pMatches.length > 0) {
          description = pMatches.map(m => cleanHtmlText(m[1])).join("\n");
        }
      }
      
      // If HTML has indicators of external company portal redirection, mark isEasyApply as false
      const isExternal = html.toLowerCase().includes("company website") || 
                         html.toLowerCase().includes("company site") || 
                         html.toLowerCase().includes("apply on company") || 
                         html.toLowerCase().includes("register and apply") || 
                         html.toLowerCase().includes("register & apply");
      isEasyApply = !isExternal;
      
    } else if (url.includes("linkedin.com")) {
      const descSelectors = [
        /<div class="show-more-less-html__markup show-more-less-html__markup--expanded">([\s\S]*?)<\/div>/i,
        /<section class="description">([\s\S]*?)<\/section>/i,
        /<div class="description__text description__text--rich">([\s\S]*?)<\/div>/i
      ];
      for (const regex of descSelectors) {
        const match = html.match(regex);
        if (match) {
          description = cleanHtmlText(match[1]);
          break;
        }
      }
      
      // If it doesn't contain "easy apply", "easy-apply", or the Easy Apply button class, it's external
      isEasyApply = html.toLowerCase().includes("easy apply") || 
                    html.toLowerCase().includes("easy-apply") || 
                    html.toLowerCase().includes("jobs-apply-button");
    }
    
    // Extract any plain text email address in the page HTML (recruiter email checks)
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i;
    const emailMatch = html.match(emailRegex);
    const hrEmail = emailMatch ? emailMatch[0] : "";
    
    return { description: description, isEasyApply: isEasyApply, hrEmail: hrEmail };
  } catch (e) {
    console.error("[JobForge Crawler] In-page same-origin fetch crashed: ", e);
    throw e;
  }
}

// ---------------- NAUKRI LISTING SCRAPER ----------------
async function crawlNaukriListings(maxJobs) {
  console.log(`[JobForge Crawler] Scraping Naukri listings, max: ${maxJobs}`);
  
  // Include standard title-links fallback directly in the wait selector list
  const selectors = ".srp-jobtuple, article.jobTuple, .jobTuple, [class*='jobTuple'], a[href*='/job-listings-']";
  await waitForSelectors(selectors, 10000);
  
  const results = [];
  
  // Try getting by card tuples first
  const tuples = document.querySelectorAll(".srp-jobtuple, article.jobTuple, .jobTuple, [class*='jobTuple']");
  if (tuples.length > 0) {
    const count = Math.min(tuples.length, maxJobs);
    console.log(`[JobForge Crawler] Naukri: Scraping ${count} cards by tuple selectors...`);
    
    for (let i = 0; i < count; i++) {
      const jt = tuples[i];
      try {
        const titleEl = jt.querySelector("a.title, .title, a[href*='/job-listings-']");
        if (!titleEl) continue;
        
        const title = cleanText(titleEl.innerText);
        let url = titleEl.getAttribute("href");
        if (url && !url.startsWith("http")) {
          url = "https://www.naukri.com" + url;
        }
        
        let cleanUrl = url ? url.split("?")[0] : "";
        if (cleanUrl.endsWith("/")) {
          cleanUrl = cleanUrl.slice(0, -1);
        }
        
        const urlParts = cleanUrl.split("/");
        const jobId = "naukri_" + urlParts[urlParts.length - 1].replace(".html", "").split("-").pop();
        
        const compEl = jt.querySelector("a.companyname, a.comp-name-link, .comp-name, .company-name, .comp-name-link, [class*='company']");
        const company = compEl ? cleanText(compEl.innerText) : "Unknown Company";
        
        const locEl = jt.querySelector(".locWdth, .location, .loc, .loc-wrap, [class*='location']");
        const location = locEl ? cleanText(locEl.innerText) : "India";
        
        const salEl = jt.querySelector(".salWdth, .salary, .sal, .sal-wrap, [class*='salary']");
        const salary = salEl ? cleanText(salEl.innerText) : "Not specified";
        
        results.push({
          id: jobId,
          title: title,
          company: company,
          location: location,
          url: cleanUrl,
          platform: "Naukri",
          salary: salary,
          description: "" 
        });
      } catch (e) {
        console.error("[JobForge Crawler] Naukri card parse error: ", e);
      }
    }
  } else {
    // Fallback: Scrape direct links
    const links = document.querySelectorAll("a[href*='/job-listings-']");
    const count = Math.min(links.length, maxJobs);
    console.log(`[JobForge Crawler] Naukri: Tuple elements empty. Scraping ${count} links via link selectors fallback...`);
    
    for (let i = 0; i < count; i++) {
      const titleEl = links[i];
      try {
        const title = cleanText(titleEl.innerText);
        if (title.length < 3) continue;
        
        let url = titleEl.getAttribute("href");
        if (url && !url.startsWith("http")) {
          url = "https://www.naukri.com" + url;
        }
        
        let cleanUrl = url ? url.split("?")[0] : "";
        if (cleanUrl.endsWith("/")) {
          cleanUrl = cleanUrl.slice(0, -1);
        }
        
        const urlParts = cleanUrl.split("/");
        const jobId = "naukri_" + urlParts[urlParts.length - 1].replace(".html", "").split("-").pop();
        
        // Find parent container dynamically
        const parent = titleEl.closest("div, article, li, [class*='job']") || titleEl.parentElement;
        const compEl = parent ? parent.querySelector("[class*='company'], [class*='comp'], a.companyname, a.comp-name-link") : null;
        const company = compEl ? cleanText(compEl.innerText) : "Unknown Company";
        
        results.push({
          id: jobId,
          title: title,
          company: company,
          location: "India",
          url: cleanUrl,
          platform: "Naukri",
          salary: "Not specified",
          description: ""
        });
      } catch (e) {
        console.error("[JobForge Crawler] Naukri link fallback parse error: ", e);
      }
    }
  }
  
  return results;
}

// ---------------- LINKEDIN LISTING SCRAPER ----------------
async function crawlLinkedInListings(maxJobs) {
  console.log(`[JobForge Crawler] Scraping LinkedIn listings, max: ${maxJobs}`);
  
  const selectors = ".jobs-search-results-list__list-item, .jobs-search__results-list li, .base-card, .base-search-card, li[data-occludable-job-id]";
  // Wait up to 10 seconds for listing container elements to paint
  await waitForSelectors(selectors, 10000);
  
  const cards = document.querySelectorAll(selectors);
  const results = [];
  let processedCount = 0;
  
  console.log(`[JobForge Crawler] LinkedIn: Scraping ${Math.min(cards.length, maxJobs)} unique job listing cards...`);
  
  for (let i = 0; i < cards.length; i++) {
    if (processedCount >= maxJobs) break;
    
    const card = cards[i];
    try {
      let titleEl = card.querySelector(
        "a.job-card-list__title, a.base-card__full-link, a[data-tracking-control-name*='job-card'], a[href*='/jobs/view/']"
      );
      
      if (!titleEl) {
        const heading = card.querySelector("h3, h4");
        if (heading) {
          titleEl = heading.querySelector("a") || heading;
        }
      }
      
      if (!titleEl) continue;
      
      let url = titleEl.getAttribute("href");
      if (!url || !url.includes("/jobs/")) continue;
      
      let title = cleanText(titleEl.innerText);
      
      if (title.toLowerCase() === "jobs" || title.toLowerCase() === "job" || title.length < 3) {
        const otherLink = card.querySelector("a[href*='/jobs/view/']");
        if (otherLink && otherLink.innerText && otherLink.innerText.trim().length > 3) {
          titleEl = otherLink;
          title = cleanText(titleEl.innerText);
          url = titleEl.getAttribute("href");
        } else {
          continue;
        }
      }
      
      if (url && !url.startsWith("http")) {
        url = "https://www.linkedin.com" + url;
      }
      
      let cleanUrl = url.split("?")[0];
      if (cleanUrl.endsWith("/")) {
        cleanUrl = cleanUrl.slice(0, -1);
      }
      
      const urlParts = cleanUrl.split("/");
      const jobId = "linkedin_" + urlParts[urlParts.length - 1];
      
      const compEl = card.querySelector(
        ".job-card-container__company-name, .base-card__subtitle, .base-search-card__subtitle, .company, [class*='company']"
      );
      const company = compEl ? cleanText(compEl.innerText) : "Unknown Company";
      
      const locEl = card.querySelector(
        ".job-card-container__metadata-item, .job-search-card__location, .location, [class*='location']"
      );
      const location = locEl ? cleanText(locEl.innerText) : "India";
      
      results.push({
        id: jobId,
        title: title,
        company: company,
        location: location,
        url: cleanUrl,
        platform: "LinkedIn",
        salary: "Not specified",
        description: "" 
      });
      
      processedCount++;
    } catch (e) {
      console.error("[JobForge Crawler] LinkedIn card parse error: ", e);
    }
  }
  
  return results;
}

// ---------------- MESSAGE DISPATCH ROUTER ----------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "CALL_FUNCTION") {
    if (message.name === "crawlNaukriListingsings" || message.name === "crawlNaukriListings") {
      crawlNaukriListings(message.args[0])
        .then(result => sendResponse({ result: result }))
        .catch(err => sendResponse({ result: [], error: err.message }));
      return true; // Keep channel open asynchronously!
    } else if (message.name === "crawlLinkedInListingsings" || message.name === "crawlLinkedInListings") {
      crawlLinkedInListings(message.args[0])
        .then(result => sendResponse({ result: result }))
        .catch(err => sendResponse({ result: [], error: err.message }));
      return true; // Keep channel open asynchronously!
    }
  } else if (message.action === "FETCH_DETAIL") {
    fetchNaukriOrLinkedInDetail(message.url)
      .then(resObj => {
        sendResponse(resObj);
      })
      .catch(err => {
        sendResponse({ description: "", isEasyApply: true, error: err.message });
      });
    return true; 
  }
  return true;
});
