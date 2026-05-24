// JobForge Chrome Extension - Dashboard Keep-Alive script (content_keepalive.js)
console.log("[JobForge] Keep-alive active. Linking dashboard tab to Extension Service Worker...");

try {
  // Establish persistent port connection to keep MV3 Service Worker alive
  const port = chrome.runtime.connect({ name: "jobforge-keepalive" });
  
  port.onDisconnect.addListener(() => {
    console.log("[JobForge] Keep-alive channel disconnected. Reconnecting...");
  });
} catch (e) {
  console.error("[JobForge] Failed to establish keep-alive port: ", e);
}
