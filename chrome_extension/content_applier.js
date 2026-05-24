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

// ---------------- LINKEDIN EASY APPLY FLOW ----------------
async function runLinkedInEasyApply(job, settings) {
  logToCloud("INFO", "[Applier] LinkedIn: Searching for 'Easy Apply' button...");
  
  const easyApplySelectors = [
    "button.jobs-apply-button",
    ".jobs-apply-button button"
  ];
  
  // Wait up to 6 seconds for the Easy Apply button to render
  let applyBtn = await waitForSelectors(easyApplySelectors, 6000);
  
  // Alternative: search all buttons containing text
  if (!applyBtn) {
    const btns = Array.from(document.querySelectorAll("button, span"));
    applyBtn = btns.find(b => b.innerText && b.innerText.trim().toLowerCase() === "easy apply");
  }
  
  if (!applyBtn) {
    // Check if already applied
    const spans = Array.from(document.querySelectorAll("span"));
    const alreadyApplied = spans.find(s => s.innerText && s.innerText.toLowerCase().includes("applied")) || 
                           document.querySelector(".artdeco-inline-feedback--success");
    if (alreadyApplied) {
      logToCloud("INFO", `[Applier] Already applied to '${job.title}' on LinkedIn.`);
      return true;
    }
    logToCloud("WARNING", "[Applier] LinkedIn: Could not find 'Easy Apply' button. This job may require external corporate site application.");
    return false;
  }
  
  logToCloud("INFO", "[Applier] LinkedIn: Clicking 'Easy Apply'...");
  applyBtn.click();
  await delay(2000);
  
  const maxSteps = 10;
  let step = 0;
  
  while (step < maxSteps) {
    // Check for success feedback
    const successSelector = document.querySelector(".artdeco-inline-feedback--success") || 
                            (document.body.innerText.includes("Application sent") || 
                             document.body.innerText.includes("application was sent"));
    if (successSelector) {
      logToCloud("INFO", "[Applier] LinkedIn: Application sent successfully!");
      return true;
    }
    
    // Check if modal is open
    const modal = document.querySelector(".jobs-easy-apply-modal, [role='dialog']");
    if (!modal) {
      logToCloud("WARNING", "[Applier] Easy Apply modal not detected. Modal might have closed or submitted.");
      // Check if modal closed due to manual action
      await delay(1000);
      if (!document.querySelector(".jobs-easy-apply-modal")) {
        return true;
      }
      break;
    }
    
    // Autofill visible fields
    logToCloud("INFO", `[Applier] Autofilling Easy Apply form step ${step + 1}...`);
    autofillLinkedInFormFields(settings);
    
    // Search buttons
    const buttons = Array.from(modal.querySelectorAll("button"));
    const nextBtn = buttons.find(b => {
      const txt = b.innerText ? b.innerText.trim().toLowerCase() : "";
      return txt === "next" || txt === "continue" || txt === "review";
    });
    
    const submitBtn = buttons.find(b => {
      const txt = b.innerText ? b.innerText.trim().toLowerCase() : "";
      return txt === "submit application" || txt === "submit";
    });
    
    if (submitBtn) {
      const reviewMode = settings.review_mode !== false;
      
      if (reviewMode) {
        logToCloud("IMPORTANT", "[Applier] REVIEW MODE ACTIVE: Forms filled successfully! A dynamic borders highlight has been activated. Please review form entries in Chrome and click 'Submit' manually.");
        
        // Dynamic border flashing alert in browser
        for (let flash = 0; flash < 5; flash++) {
          document.body.style.border = "6px solid #a855f7";
          await delay(300);
          document.body.style.border = "none";
          await delay(300);
        }
        
        // Wait up to 120 seconds for user manual action
        logToCloud("INFO", "[Applier] Paused: Waiting up to 2 minutes for user manual review and submission...");
        for (let wait = 0; wait < 120; wait++) {
          await delay(1000);
          // Check if modal is gone (user submitted!)
          if (!document.querySelector(".jobs-easy-apply-modal, [role='dialog']")) {
            logToCloud("INFO", "[Applier] Form submission detected! Proceeding...");
            return true;
          }
        }
        logToCloud("WARNING", "[Applier] Review timeout reached. Moving on.");
        return false;
      } else {
        logToCloud("INFO", "[Applier] Auto-submit Mode active. Submitting application form...");
        submitBtn.click();
        await delay(3000);
        return true;
      }
    } else if (nextBtn) {
      logToCloud("INFO", "[Applier] Moving to next page...");
      nextBtn.click();
      await delay(1500);
      step++;
    } else {
      logToCloud("WARNING", "[Applier] No navigation buttons found. Application questionnaire might require manual fields completion.");
      break;
    }
  }
  
  return false;
}

// Autofill LinkedIn modal inputs
function autofillLinkedInFormFields(settings) {
  // 1. Text fields and Textareas
  const inputs = document.querySelectorAll("input[type='text'], textarea, input[type='email'], input[type='tel']");
  inputs.forEach(input => {
    try {
      if (input.value && input.value.trim() !== "") return; // Don't overwrite existing
      
      const id = input.getAttribute("id");
      let labelText = "";
      if (id) {
        const label = document.querySelector(`label[for='${id}']`);
        if (label) labelText = label.innerText.toLowerCase();
      }
      
      if (!labelText) {
        // Fallback: search closest parent label text
        const parent = input.closest(".fb-form-element-container");
        if (parent) {
          const l = parent.querySelector("label");
          if (l) labelText = l.innerText.toLowerCase();
        }
      }
      
      if (labelText.includes("experience") || labelText.includes("years")) {
        if (labelText.includes("python")) {
          input.value = "4";
        } else if (labelText.includes("java")) {
          input.value = "3";
        } else if (labelText.includes("ai") || labelText.includes("llm")) {
          input.value = "2";
        } else {
          input.value = "4"; // Default
        }
        triggerInputChange(input);
      } else if (labelText.includes("salary") || labelText.includes("expected")) {
        input.value = "Negotiable";
        triggerInputChange(input);
      } else if (labelText.includes("notice") || labelText.includes("days")) {
        input.value = "30 days";
        triggerInputChange(input);
      } else if (labelText.includes("website") || labelText.includes("portfolio")) {
        input.value = "https://github.com/tkdrohit1";
        triggerInputChange(input);
      } else if (labelText.includes("linkedin")) {
        input.value = "https://linkedin.com/in/tkdrohit";
        triggerInputChange(input);
      }
    } catch (e) {
      console.error("[JobForge Applier] Input fill err: ", e);
    }
  });

  // 2. Radio Yes/No buttons
  const fieldsets = document.querySelectorAll("fieldset");
  fieldsets.forEach(fs => {
    try {
      const legend = fs.querySelector("legend");
      const question = legend ? legend.innerText.toLowerCase() : "";
      
      const labels = Array.from(fs.querySelectorAll("label"));
      let yesBtn = labels.find(l => l.innerText && l.innerText.trim().toLowerCase() === "yes") || 
                   fs.querySelector("input[value='Yes'], label[for*='yes']");
      let noBtn = labels.find(l => l.innerText && l.innerText.trim().toLowerCase() === "no") || 
                  fs.querySelector("input[value='No'], label[for*='no']");
      
      if (question.includes("authorized to work") || question.includes("sponsorship") === false) {
        if (question.includes("sponsor")) {
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
    logToCloud("INFO", "[Applier] Resume upload field detected. LinkedIn will default select your pre-uploaded profile resume. Confirm if chosen.");
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
        success = await runLinkedInEasyApply(message.job, message.settings);
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
