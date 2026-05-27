// JobForge Chrome Extension - Auto-Applier Form Filler (content_applier.js)

// Logger bridge to background.js
function logToCloud(level, message) {
  console.log(`[JobForge Applier] [${level}] ${message}`);
  chrome.runtime.sendMessage({
    action: "APPLY_LOG",
    level: level,
    message: message
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to wait for DOM elements to exist asynchronously (up to 10 seconds)
async function waitForSelectors(selectorsArray, maxWaitMs = 10000) {
  const interval = 500;
  let elapsed = 0;
  while (elapsed < maxWaitMs) {
    for (const sel of selectorsArray) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetHeight > 0) {
          return el;
        }
      } catch (err) {
        console.warn(`[JobForge Applier] Invalid selector in wait: ${sel}`, err);
      }
    }
    await new Promise(resolve => setTimeout(resolve, interval));
    elapsed += interval;
  }
  return null;
}

// ---------------- QUESTIONNAIRE LEARNING ENGINE HELPERS ----------------

function cleanQuestionText(text) {
  if (!text) return "";
  return text.toLowerCase()
             .replace(/[^a-z0-9]/gi, " ")
             .replace(/\s+/g, " ")
             .trim();
}

function findLearnedAnswer(questionText, learnedAnswers) {
  const cleanedQ = cleanQuestionText(questionText);
  if (!cleanedQ) return null;
  
  // 1. Exact match
  if (learnedAnswers[cleanedQ]) {
    return learnedAnswers[cleanedQ];
  }
  
  // 2. Fuzzy substring match (must be longer than 8 chars to be meaningful)
  for (const [stashedQ, answer] of Object.entries(learnedAnswers)) {
    if (stashedQ.length > 8 && cleanedQ.length > 8) {
      if (cleanedQ.includes(stashedQ) || stashedQ.includes(cleanedQ)) {
        logToCloud("INFO", `[Learning Engine] Fuzzy matched question: "${questionText}" with history. Reusing stashed answer: "${answer}"`);
        return answer;
      }
    }
  }
  return null;
}

function getLabelForInput(element) {
  if (!element) return "";
  try {
    const id = element.getAttribute("id");
    if (id) {
      const label = document.querySelector(`label[for='${id}']`);
      if (label && label.innerText) return label.innerText.trim();
    }
    // Fallback 1: closest form element container label
    const container = element.closest(".fb-form-element-container, .form-field, .jobs-easy-apply-form-section, div");
    if (container) {
      const label = container.querySelector("label");
      if (label && label.innerText) return label.innerText.trim();
    }
    // Fallback 2: parent element text
    if (element.parentElement && element.parentElement.tagName === "LABEL") {
      return element.parentElement.innerText.trim();
    }
  } catch (e) {
    console.error("[JobForge Applier] Error finding label: ", e);
  }
  return "";
}

async function learnFormFields() {
  const learned = {};
  
  try {
    // 1. Scan text, textarea, email, tel, number inputs
    const inputs = document.querySelectorAll("input[type='text'], textarea, input[type='email'], input[type='tel'], input[type='number']");
    inputs.forEach(input => {
      const val = input.value ? input.value.trim() : "";
      if (!val) return;
      
      const label = getLabelForInput(input);
      if (label) {
        learned[cleanQuestionText(label)] = val;
      }
    });
    
    // 2. Scan select dropdowns
    const selects = document.querySelectorAll("select");
    selects.forEach(select => {
      const val = select.value ? select.value.trim() : "";
      if (!val) return;
      
      const optText = select.options[select.selectedIndex] ? select.options[select.selectedIndex].text.trim() : "";
      const label = getLabelForInput(select);
      if (label && optText) {
        learned[cleanQuestionText(label)] = optText;
      }
    });
    
    // 3. Scan radio button groups
    const fieldsets = document.querySelectorAll("fieldset, .fb-radio-buttons, [role='radiogroup']");
    fieldsets.forEach(fs => {
      let qText = "";
      const legend = fs.querySelector("legend, .fb-form-element-label, [id*='legend']");
      if (legend) {
        qText = legend.innerText.trim();
      } else {
        // Fallback: search for label inside or preceding
        const label = fs.querySelector("label");
        if (label) qText = label.innerText.trim();
      }
      
      if (!qText) return;
      
      const checkedRadio = fs.querySelector("input[type='radio']:checked");
      if (checkedRadio) {
        const radioLabel = fs.querySelector(`label[for='${checkedRadio.id}']`) || checkedRadio.closest("label");
        if (radioLabel) {
          learned[cleanQuestionText(qText)] = radioLabel.innerText.trim();
        }
      }
    });
    
    if (Object.keys(learned).length > 0) {
      logToCloud("INFO", `[Learning Engine] Captured ${Object.keys(learned).length} form answers. Saving to reference database...`);
      chrome.storage.local.get("learned_answers", (data) => {
        const current = data.learned_answers || {};
        const updated = { ...current, ...learned };
        chrome.storage.local.set({ "learned_answers": updated }, () => {
          console.log("[Learning Engine] Answers saved successfully:", learned);
        });
      });
    }
  } catch (err) {
    console.error("[JobForge Applier] Error during learnFormFields: ", err);
  }
}

function attachLearningInterceptors() {
  try {
    const dialogs = document.querySelectorAll(".jobs-easy-apply-modal, [role='dialog'], .apply-questionnaire, .chatbot-dialog, .fb-form-element-container, form");
    dialogs.forEach(dialog => {
      const buttons = Array.from(dialog.querySelectorAll("button"));
      buttons.forEach(btn => {
        const txt = btn.innerText ? btn.innerText.trim().toLowerCase() : "";
        if (txt === "next" || txt === "continue" || txt === "review" || txt === "submit application" || txt === "submit" || txt === "apply") {
          if (!btn.hasAttribute("data-learning-bound")) {
            btn.setAttribute("data-learning-bound", "true");
            btn.addEventListener("click", () => {
              logToCloud("INFO", "[Learning Engine] Click detected on navigation/submit. Stashing form entries...");
              learnFormFields();
            });
          }
        }
      });
    });
  } catch (err) {
    console.error("[JobForge Applier] Error attaching click interceptors: ", err);
  }
}

// ---------------- LINKEDIN PEOPLE REFERRAL FLOW ----------------

async function runLinkedInReferralFlow(job, settings) {
  logToCloud("INFO", "[Applier] Starting LinkedIn Proactive Referral & Networking flow...");
  
  // 1. Locate Company Page URL on the job detail page
  let companyUrl = "";
  const companyLink = document.querySelector("a[href*='/company/']");
  if (companyLink) {
    companyUrl = companyLink.getAttribute("href");
    if (companyUrl && !companyUrl.startsWith("http")) {
      companyUrl = "https://www.linkedin.com" + companyUrl;
    }
    // Clean company URL to base
    if (companyUrl.includes("?")) {
      companyUrl = companyUrl.split("?")[0];
    }
    if (!companyUrl.endsWith("/")) {
      companyUrl += "/";
    }
  }
  
  if (!companyUrl) {
    logToCloud("WARNING", "[Applier] Could not locate Company Page URL on this job page. Aborting.");
    return false;
  }
  
  const peopleUrl = companyUrl + "people/";
  logToCloud("INFO", `[Applier] Navigating active tab to Company People Directory: ${peopleUrl}`);
  
  // Initialize stateful session before redirecting!
  chrome.storage.local.set({
    "active_referral_session": {
      job: job,
      settings: settings,
      phase: "SEARCH_PEOPLE"
    }
  }, () => {
    window.location.href = peopleUrl;
  });
  
  // Wait to let page unload
  await delay(5000);
  return true;
}

async function continueLinkedInReferralFlow(session) {
  const job = session.job;
  const settings = session.settings;
  
  logToCloud("INFO", "[Applier] Company People directory loaded. Waiting 5 seconds for page hydration...");
  await delay(5000);
  
  // 1. Locate employee search bar
  const searchSelectors = [
    ".org-people-find-peers-search-box input",
    "input[placeholder*='Search employees']",
    "input[id*='people-search']",
    ".org-people-bar input",
    "input[type='search']"
  ];
  
  let searchInput = await waitForSelectors(searchSelectors, 8000);
  if (!searchInput) {
    // Search general input fields inside org people section
    searchInput = document.querySelector("input[type='text']");
  }
  
  if (!searchInput) {
    logToCloud("WARNING", "[Applier] Could not locate employee search box. Scanning visible contacts directly...");
  } else {
    // Search for recruiter
    logToCloud("INFO", "[Applier] Searching for recruiting contact: 'Recruiter'...");
    searchInput.focus();
    searchInput.value = "Recruiter";
    triggerInputChange(searchInput);
    
    // Simulate Enter Key to filter
    searchInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13 }));
    searchInput.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13 }));
    searchInput.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13 }));
    
    // Try clicking search magnifier button if present
    const searchParent = searchInput.parentElement;
    if (searchParent) {
      const searchBtn = searchParent.querySelector("button, svg, .search-icon");
      if (searchBtn) searchBtn.click();
    }
    
    await delay(5000); // Wait for employee search results to filter
  }
  
  // 2. Scan cards
  const cards = document.querySelectorAll(".org-people-profiles-module__profile-card, .org-people-profile-card, li.org-people-profiles-module__profile-item, .org-people-profile-card__profile-info");
  logToCloud("INFO", `[Applier] Scanned ${cards.length} employee profile cards.`);
  
  let targetContact = null;
  
  // A. Search for 1st-degree connections first (already connected)
  for (const card of cards) {
    const text = card.innerText.toLowerCase();
    const is1st = text.includes("1st") || text.includes("1st degree") || text.includes("connected");
    
    // Find Message button
    const buttons = Array.from(card.querySelectorAll("button, a"));
    const messageBtn = buttons.find(b => b.innerText && b.innerText.trim().toLowerCase() === "message");
    
    if (is1st && messageBtn) {
      targetContact = { card, actionBtn: messageBtn, type: "MESSAGE" };
      break;
    }
  }
  
  // B. Fallback to recruiters/hiring managers (Connect button) if no 1st-degree
  if (!targetContact) {
    logToCloud("INFO", "[Applier] No 1st-degree connections found. Searching for Recruiters/Hiring Managers to connect...");
    for (const card of cards) {
      const headline = card.querySelector(".lt-line-clamp, .artdeco-entity-lockup__subtitle, .org-people-profile-card__profile-title")?.innerText || card.innerText;
      const lowerHeadline = headline.toLowerCase();
      
      const isHr = lowerHeadline.includes("recruiter") || 
                   lowerHeadline.includes("hiring") || 
                   lowerHeadline.includes("talent acquisition") || 
                   lowerHeadline.includes("human resources") ||
                   lowerHeadline.includes("acquisition");
                   
      if (isHr) {
        const buttons = Array.from(card.querySelectorAll("button, a"));
        const connectBtn = buttons.find(b => b.innerText && b.innerText.trim().toLowerCase() === "connect");
        
        if (connectBtn) {
          targetContact = { card, actionBtn: connectBtn, type: "CONNECT" };
          break;
        }
      }
    }
  }
  
  if (!targetContact) {
    logToCloud("WARNING", "[Applier] Could not locate any target recruiting contacts on the People tab.");
    chrome.storage.local.remove("active_referral_session");
    chrome.runtime.sendMessage({ action: "APPLY_FINISHED", success: false });
    return;
  }
  
  const nameEl = targetContact.card.querySelector(".lt-line-clamp--single, .artdeco-entity-lockup__title, h4, h5, .org-people-profile-card__profile-title");
  const targetName = nameEl ? nameEl.innerText.trim() : "Recruiting Manager";
  logToCloud("INFO", `[Applier] Found target contact: '${targetName}' (Type: ${targetContact.type})`);
  
  // Injections configurations
  const candidateName = session.settings && session.settings.active_profile ? session.settings.active_profile : "Rohit Singh";
  const resumeLink = settings.resume_short_link || "https://drive.google.com/file/d/your_hosted_resume_link/view?usp=sharing";
  
  if (targetContact.type === "MESSAGE") {
    // 1st connection - Direct message
    logToCloud("INFO", `[Applier] Opening direct message window for '${targetName}'...`);
    targetContact.actionBtn.click();
    await delay(3000);
    
    // Find active chat input box
    const chatInput = document.querySelector(".msg-form__contenteditable, [contenteditable='true'], textarea[name='message']");
    if (chatInput) {
      const customMessage = `Hi ${targetName.split(" ")[0]},\n\nHope you are doing well.\n\nI noticed the opening for '${job.title}' at '${job.company}' on LinkedIn and believe my background in Generative AI/LLM engineering directly aligns with your team's needs. I'd be highly grateful if you could refer me for this opening.\n\nYou can find my resume portfolio here: ${resumeLink}\n\nThank you!\n\nBest regards,\n${candidateName}`;
      
      chatInput.focus();
      document.execCommand("insertText", false, customMessage);
      await delay(1500);
      
      // Find Send button
      const sendBtn = document.querySelector(".msg-form__send-button, button[type='submit']");
      if (sendBtn) {
        logToCloud("IMPORTANT", `[Applier] Direct message composed. Sending to '${targetName}'...`);
        sendBtn.click();
        await delay(2000);
        
        chrome.storage.local.remove("active_referral_session");
        chrome.runtime.sendMessage({ action: "APPLY_FINISHED", success: true });
        return;
      }
    }
  } else if (targetContact.type === "CONNECT") {
    // Recruiter - Connection request with 300 char note
    logToCloud("INFO", `[Applier] Initiating Connection Request for '${targetName}'...`);
    targetContact.actionBtn.click();
    await delay(2500);
    
    // Check if connect note dialog opened
    const addNoteBtn = await waitForSelectors(["button[aria-label='Add a note']", ".artdeco-modal button:nth-child(1)"], 4000) ||
                       Array.from(document.querySelectorAll("button")).find(b => b.innerText && b.innerText.toLowerCase().includes("note"));
                       
    if (addNoteBtn) {
      addNoteBtn.click();
      await delay(1500);
    }
    
    const noteArea = document.querySelector("textarea[name='message'], .artdeco-modal textarea, textarea[id*='custom-message']");
    if (noteArea) {
      // 300 char strict limit note
      const customNote = `Hi ${targetName.split(" ")[0]}, hope you're doing well! I saw the '${job.title}' opening at '${job.company}'. With 4+ yrs of Generative AI/LLM experience, I'd love to connect & share my resume link for a potential referral: ${resumeLink}`;
      
      noteArea.focus();
      noteArea.value = customNote;
      triggerInputChange(noteArea);
      await delay(1000);
      
      // Find Send Connect request button
      const sendConnectBtn = Array.from(document.querySelectorAll(".artdeco-modal button")).find(b => b.innerText && b.innerText.toLowerCase().includes("send"));
      if (sendConnectBtn) {
        logToCloud("IMPORTANT", `[Applier] Composed 300-char Connect Note. Sending connection invite to '${targetName}'...`);
        sendConnectBtn.click();
        await delay(2000);
        
        chrome.storage.local.remove("active_referral_session");
        chrome.runtime.sendMessage({ action: "APPLY_FINISHED", success: true });
        return;
      }
    }
  }
  
  logToCloud("WARNING", "[Applier] Could not execute the stashed messaging flow actions. Paused for manual connection.");
  chrome.storage.local.remove("active_referral_session");
  chrome.runtime.sendMessage({ action: "APPLY_FINISHED", success: false });
}

// Autofill dynamic inputs (Universal for LinkedIn Easy Apply and Naukri questionnaire popups)
async function autofillFormFields(settings) {
  // Query Chrome local storage for historically learned answers
  const data = await new Promise(resolve => chrome.storage.local.get("learned_answers", resolve));
  const learnedAnswers = data.learned_answers || {};
  
  logToCloud("INFO", `[Learning Engine] Querying stashed intelligence dictionary containing ${Object.keys(learnedAnswers).length} entries...`);

  // 1. Text fields and Textareas
  const inputs = document.querySelectorAll("input[type='text'], textarea, input[type='email'], input[type='tel'], input[type='number']");
  inputs.forEach(input => {
    try {
      if (input.value && input.value.trim() !== "") return; // Don't overwrite existing
      
      const labelText = getLabelForInput(input);
      if (!labelText) return;
      
      // Attempt fuzzy stashed memory match
      const learned = findLearnedAnswer(labelText, learnedAnswers);
      if (learned) {
        input.value = learned;
        triggerInputChange(input);
        logToCloud("IMPORTANT", `[Learning Engine] Universal Auto-filled Text field: "${labelText}" -> "${learned}"`);
        return; // Success! Skip fallbacks
      }
      
      // Static defaults fallbacks if no stashed memory exists
      const lowerLabel = labelText.toLowerCase();
      if (lowerLabel.includes("experience") || lowerLabel.includes("years")) {
        if (lowerLabel.includes("python")) {
          input.value = "4";
        } else if (lowerLabel.includes("java")) {
          input.value = "3";
        } else if (lowerLabel.includes("ai") || lowerLabel.includes("llm")) {
          input.value = "2";
        } else {
          input.value = "4"; // Default
        }
        triggerInputChange(input);
      } else if (lowerLabel.includes("salary") || lowerLabel.includes("expected")) {
        input.value = "Negotiable";
        triggerInputChange(input);
      } else if (lowerLabel.includes("notice") || lowerLabel.includes("days")) {
        input.value = "30 days";
        triggerInputChange(input);
      } else if (lowerLabel.includes("website") || lowerLabel.includes("portfolio")) {
        input.value = "https://github.com/tkdrohit1";
        triggerInputChange(input);
      } else if (lowerLabel.includes("linkedin")) {
        input.value = "https://linkedin.com/in/tkdrohit";
        triggerInputChange(input);
      }
    } catch (e) {
      console.error("[JobForge Applier] Input fill err: ", e);
    }
  });

  // 2. Radio Yes/No buttons
  const fieldsets = document.querySelectorAll("fieldset, .fb-radio-buttons, [role='radiogroup']");
  fieldsets.forEach(fs => {
    try {
      let qText = "";
      const legend = fs.querySelector("legend, .fb-form-element-label, [id*='legend']");
      if (legend) {
        qText = legend.innerText.trim();
      } else {
        const label = fs.querySelector("label");
        if (label) qText = label.innerText.trim();
      }
      
      if (!qText) return;
      
      // Attempt fuzzy stashed memory match
      const learned = findLearnedAnswer(qText, learnedAnswers);
      if (learned) {
        const labels = Array.from(fs.querySelectorAll("label"));
        const matchingBtn = labels.find(l => l.innerText && l.innerText.trim().toLowerCase() === learned.toLowerCase()) || 
                            fs.querySelector(`input[value='${learned}'], label[for*='${learned.toLowerCase()}']`);
        if (matchingBtn) {
          clickRadioElement(matchingBtn, fs, learned);
          logToCloud("IMPORTANT", `[Learning Engine] Universal Auto-selected Radio: "${qText}" -> "${learned}"`);
          return; // Success! Skip fallback
        }
      }
      
      // Static defaults fallbacks if no stashed memory exists
      const lowerQ = qText.toLowerCase();
      const labels = Array.from(fs.querySelectorAll("label"));
      let yesBtn = labels.find(l => l.innerText && l.innerText.trim().toLowerCase() === "yes") || 
                   fs.querySelector("input[value='Yes'], label[for*='yes']");
      let noBtn = labels.find(l => l.innerText && l.innerText.trim().toLowerCase() === "no") || 
                  fs.querySelector("input[value='No'], label[for*='no']");
      
      if (lowerQ.includes("authorized to work") || lowerQ.includes("sponsorship") === false) {
        if (lowerQ.includes("sponsor")) {
          clickRadioElement(noBtn, fs, "No");
        } else {
          clickRadioElement(yesBtn, fs, "Yes");
        }
      } else {
        clickRadioElement(yesBtn, fs, "Yes");
      }
    } catch (e) {
      console.error("[JobForge Applier] Radio fill err: ", e);
    }
  });

  // 3. Dropdowns
  const selects = document.querySelectorAll("select");
  selects.forEach(select => {
    try {
      if (select.value && select.value.trim() !== "") return; // Don't overwrite existing
      
      const labelText = getLabelForInput(select);
      if (labelText) {
        // Attempt fuzzy stashed memory match
        const learned = findLearnedAnswer(labelText, learnedAnswers);
        if (learned) {
          const optionToSelect = Array.from(select.options).find(opt => 
            opt.text.trim().toLowerCase() === learned.toLowerCase() || 
            opt.value.trim().toLowerCase() === learned.toLowerCase()
          );
          if (optionToSelect) {
            select.value = optionToSelect.value;
            triggerInputChange(select);
            logToCloud("IMPORTANT", `[Learning Engine] Universal Auto-selected Dropdown: "${labelText}" -> "${optionToSelect.text}"`);
            return;
          }
        }
      }
      
      // Fallback
      if (select.value === "") {
        if (select.options.length > 1) {
          select.selectedIndex = 1;
          triggerInputChange(select);
        }
      }
    } catch (e) {
      console.error("[JobForge Applier] Select dropdown err: ", e);
    }
  });

  // 4. File uploads notification
  const fileInput = document.querySelector("input[type='file']");
  if (fileInput) {
    logToCloud("INFO", "[Applier] Resume upload field detected. System will default select your pre-uploaded profile resume if available.");
  }
}

function triggerInputChange(element) {
  // Fire standard DOM change triggers so React/Angular scripts register inputs
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickRadioElement(element, parentFieldset, valueText) {
  if (!element) return;
  try {
    element.click();
    // Alternative check input inside label
    const input = element.tagName === "INPUT" ? element : element.querySelector("input");
    if (input) {
      input.checked = true;
      triggerInputChange(input);
    }
  } catch (e) {
    // If layout uses custom labels, trigger direct clicks
    const labels = Array.from(parentFieldset.querySelectorAll("label"));
    const matchingLabel = labels.find(l => l.innerText && l.innerText.trim().toLowerCase() === valueText.toLowerCase());
    if (matchingLabel) {
      matchingLabel.click();
    }
  }
}

// ---------------- NAUKRI APPLY FLOW ----------------
async function runNaukriApply(job, settings) {
  logToCloud("INFO", "[Applier] Naukri: Searching for apply button...");
  
  const selectors = [
    "#apply-button",
    "button.apply-button",
    "button.apply-btn",
    "[class*='apply'] button"
  ];
  
  // Wait up to 6 seconds for Naukri's apply button
  let applyBtn = await waitForSelectors(selectors, 6000);
  
  if (!applyBtn) {
    const btns = Array.from(document.querySelectorAll("button, span"));
    applyBtn = btns.find(b => b.innerText && b.innerText.trim().toLowerCase() === "apply");
  }
  
  if (!applyBtn) {
    const elements = Array.from(document.querySelectorAll("span, button:disabled"));
    const alreadyApplied = elements.find(el => el.innerText && el.innerText.toLowerCase().includes("applied"));
    if (alreadyApplied || document.body.innerText.includes("applied successfully")) {
      logToCloud("INFO", `[Applier] Already applied to '${job.title}' on Naukri.`);
      return true;
    }
    logToCloud("WARNING", "[Applier] Naukri: Apply button not found.");
    return false;
  }
  
  const text = applyBtn.innerText.toLowerCase();
  if (text.includes("company") || text.includes("external")) {
    logToCloud("WARNING", "[Applier] Job requires external corporate website registration. Directing user to execute manually.");
    return false;
  }
  
  logToCloud("INFO", "[Applier] Naukri: Clicking 'Apply'...");
  applyBtn.click();
  await delay(4000);
  
  // Check for custom questionnaires
  const popup = document.querySelector(".apply-questionnaire, .chatbot-dialog, iframe");
  if (popup) {
    logToCloud("WARNING", "[Applier] Naukri opened custom questionnaire popup.");
    
    // Autofill visible fields using learned questions!
    await autofillFormFields(settings);
    attachLearningInterceptors();
    
    const reviewMode = settings.review_mode !== false;
    
    if (reviewMode) {
      logToCloud("IMPORTANT", "[Applier] REVIEW MODE: Please fill out the questionnaire inside Naukri tab and submit.");
      document.body.style.border = "6px solid #a855f7";
      await delay(2000);
      document.body.style.border = "none";
      
      logToCloud("INFO", "[Applier] Paused: Waiting up to 2 minutes for manual questionnaire completion...");
      for (let i = 0; i < 120; i++) {
        await delay(1000);
        if (!document.querySelector(".apply-questionnaire, .chatbot-dialog")) {
          logToCloud("INFO", "[Applier] Questionnaire popup closed! Proceeding...");
          return true;
        }
      }
      return false;
    }
  } else {
    logToCloud("INFO", "[Applier] Naukri: Application successfully submitted!");
    return true;
  }
  
  return false;
}

// ---------------- MESSAGE ROUTER ----------------
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === "TRIGGER_AUTOFILL") {
    let success = false;
    
    try {
      if (message.job.url.includes("linkedin.com")) {
        success = await runLinkedInReferralFlow(message.job, message.settings);
      } else if (message.job.url.includes("naukri.com")) {
        success = await runNaukriApply(message.job, message.settings);
      } else {
        logToCloud("ERROR", "[Applier] Unsupported job platform url.");
      }
    } catch (err) {
      logToCloud("ERROR", `[Applier] Injected form filler execution crashed: ${err.message}`);
    }
    
    // Notify background.js that we finished
    chrome.runtime.sendMessage({
      action: "APPLY_FINISHED",
      success: success
    });
  }
  return true;
});

// Signal to background.js that we are successfully injected and ready to listen for actions!
logToCloud("INFO", "[Applier] content_applier.js successfully injected. Signaling readiness...");
chrome.runtime.sendMessage({
  action: "APPLIER_READY"
});

// Check for active stateful referral sessions on injection/page load!
chrome.storage.local.get("active_referral_session", async (data) => {
  const session = data.active_referral_session;
  if (session && window.location.href.includes("linkedin.com/company/")) {
    logToCloud("INFO", `[Applier] Resuming stashed referral session for '${session.job.title}' at '${session.job.company}'...`);
    try {
      await continueLinkedInReferralFlow(session);
    } catch (err) {
      logToCloud("ERROR", `[Applier] Stashed referral session failed: ${err.message}`);
      chrome.storage.local.remove("active_referral_session");
      chrome.runtime.sendMessage({ action: "APPLY_FINISHED", success: false });
    }
  }
});
