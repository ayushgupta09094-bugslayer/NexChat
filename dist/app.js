import {
  signUp,
  signIn,
  logOut,
  getUserData,
  getOrCreateChat,
  startMessagesListener,
  sendMsg,
  watchContactStatus,
  loadAllUsersData,
  friendlyErr
} from "./firebase.js";
// ════════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════════
let currentUser      = null;
let currentChatId    = null;
let currentContactId = null;
let allChats         = [];
let allUsers         = [];
// ════════════════════════════════════════════════════════════
//  DOM HELPER
// ════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
// ════════════════════════════════════════════════════════════
//  ESCAPE HTML — prevent XSS
// ════════════════════════════════════════════════════════════
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
// ════════════════════════════════════════════════════════════
//  AVATAR HELPERS
// ════════════════════════════════════════════════════════════
function initials(name = "") {
  return name.split(" ").map(w => w[0] || "").join("").slice(0, 2).toUpperCase() || "?";
}
function hashColor(uid = "") {
  const palette = [
    ["#B8860B", "#FFD700"], ["#7A5C00", "#E6A817"],
    ["#A07000", "#FFC200"], ["#8B6914", "#FBBF24"],
    ["#6B4F00", "#F59E0B"], ["#9D7A00", "#FDE68A"]
  ];
  let h = 0;
  for (const c of uid) h = (h + c.charCodeAt(0)) % palette.length;
  return palette[h];
}
function avatarStyle(uid) {
  const [c1, c2] = hashColor(uid);
  return `background:linear-gradient(135deg,${c1},${c2})`;
}
// ════════════════════════════════════════════════════════════
//  TIME / DATE FORMATTERS
// ════════════════════════════════════════════════════════════
function fmtTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtChatTime(ts) {
  if (!ts) return "";
  const d   = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (now.toDateString() === d.toDateString()) return fmtTime(ts);
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}
function fmtDateLabel(ts) {
  if (!ts) return "Today";
  const d   = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (now.toDateString() === d.toDateString()) return "Today";
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}
function fmtLastSeen(ts) {
  if (!ts) return "a while ago";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
// ════════════════════════════════════════════════════════════
//  TOAST
// ════════════════════════════════════════════════════════════
window.showToast = function(msg, ms = 3000) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), ms);
};
function showErr(elId, msg) {
  const el = $(elId);
  el.textContent = msg;
  el.style.display = "block";
}
function clearErr(elId) {
  $(elId).style.display = "none";
}
// ════════════════════════════════════════════════════════════
//  AUTH STATE CALLBACK (called from firebase.js)
// ════════════════════════════════════════════════════════════
export function onAuthReady(user, isLoggedIn) {
  $("loading-screen").style.display = "none";
  if (isLoggedIn && user) {
    currentUser = user;
    $("auth-screen").style.display = "none";
    $("app-screen").style.display  = "block";
    initAppUI();
    // Register users callback
    window.__onUsersLoaded = users => {
      allUsers = users;
      renderUsersList(allUsers);
    };
  } else {
    currentUser   = null;
    currentChatId = null;
    $("auth-screen").style.display = "flex";
    $("app-screen").style.display  = "none";
  }
}
// ════════════════════════════════════════════════════════════
//  INIT APP UI — populate profile & avatar
// ════════════════════════════════════════════════════════════
function initAppUI() {
  const name = currentUser.displayName || "NexUser";
  const ini  = initials(name);
  const av   = avatarStyle(currentUser.uid);
  $("profile-av-big").textContent   = ini;
  $("profile-av-big").style.cssText = av;
  $("profile-disp-name").textContent  = name;
  $("profile-disp-email").textContent = currentUser.email;
  if (currentUser.metadata?.creationTime) {
    const d = new Date(currentUser.metadata.creationTime);
    $("profile-since").textContent = d.toLocaleDateString([], {
      month: "long", day: "numeric", year: "numeric"
    });
  }
}
// ════════════════════════════════════════════════════════════
//  AUTH HANDLERS
// ════════════════════════════════════════════════════════════
window.handleLogin = async function(e) {
  e.preventDefault();
  clearErr("login-error");
  const btn   = $("login-btn");
  const email = $("login-email").value.trim();
  const pass  = $("login-password").value;
  btn.disabled   = true;
  btn.textContent = "Signing in…";
  try {
    await signIn(email, pass);
    showToast("Welcome back to NexChat! ⚡");
  } catch (err) {
    showErr("login-error", friendlyErr(err.code));
    btn.disabled   = false;
    btn.textContent = "Sign In to NexChat";
  }
};
window.handleSignup = async function(e) {
  e.preventDefault();
  clearErr("signup-error");
  const btn   = $("signup-btn");
  const name  = $("signup-name").value.trim();
  const email = $("signup-email").value.trim();
  const pass  = $("signup-password").value;
  const conf  = $("signup-confirm").value;
  if (pass !== conf) { showErr("signup-error", "Passwords do not match."); return; }
  btn.disabled   = true;
  btn.textContent = "Creating account…";
  try {
    await signUp(name, email, pass);
    showToast(`Welcome to NexChat, ${name}! 🎉⚡`);
  } catch (err) {
    showErr("signup-error", friendlyErr(err.code));
    btn.disabled   = false;
    btn.textContent = "Create NexChat Account";
  }
};
window.handleLogout = async function() {
  await logOut(currentUser?.uid);
  const profilePanel = $("profile-panel");
  if (profilePanel?.classList.contains("open")) profilePanel.classList.remove("open");
  showToast("Signed out. See you soon! ✌️");
};
window.switchTab = function(tab) {
  $("login-form").style.display  = tab === "login"  ? "flex" : "none";
  $("signup-form").style.display = tab === "signup" ? "flex" : "none";
  $("tab-login").classList.toggle("active",  tab === "login");
  $("tab-signup").classList.toggle("active", tab === "signup");
  clearErr("login-error");
  clearErr("signup-error");
};
// ════════════════════════════════════════════════════════════
//  USERS — Render & Filter
// ════════════════════════════════════════════════════════════
function renderUsersList(users) {
  const list = $("users-list");
  if (!list) return;

  const safeUsers = (users || [])
    .filter(u => u && u.id && u.id !== currentUser?.uid && u.uid !== currentUser?.uid)
    .filter(u => String(u.email || "").toLowerCase() !== String(currentUser?.email || "").toLowerCase());

  if (!safeUsers.length) {
    list.innerHTML = `<div class="no-chats-msg"><i class="fa-solid fa-users"></i><p>No other users found.<br/>Create another account in a different browser to test chat.</p></div>`;
    return;
  }

  list.innerHTML = "";

  safeUsers.forEach(u => {
    const name  = String(u.name || u.displayName || "NexUser");
    const email = String(u.email || "");

    const item = document.createElement("button");
    item.type = "button";
    item.className = "user-item";
    item.setAttribute("aria-label", `Start chat with ${name}`);
    item.innerHTML = `
      <div class="c-avatar" style="${avatarStyle(u.id)};width:44px;height:44px;border-radius:13px;font-size:16px">
        ${esc(initials(name))}
        <div class="status-dot${u.online ? "" : " offline"}"></div>
      </div>
      <div class="user-item-text">
        <div class="user-item-name">${esc(name)}</div>
        <div class="user-item-email">${esc(email)}</div>
      </div>
      ${u.online ? '<div class="user-online-tag">● ONLINE</div>' : ""}
    `;
    item.addEventListener("click", () => startChat(u.id, name));
    list.appendChild(item);
  });
}

window.filterUsers = function() {
  const q = $("user-search-inp").value.toLowerCase();
  renderUsersList(
    q ? allUsers.filter(u =>
      String(u.name || "").toLowerCase().includes(q) ||
      String(u.email || "").toLowerCase().includes(q)
    ) : allUsers
  );
};
// ════════════════════════════════════════════════════════════
//  CHATS — Callback from firebase.js
// ════════════════════════════════════════════════════════════
export function onChatsUpdate(chats) {
  allChats = chats;
  renderChatsList(allChats);
}
function renderChatsList(chats) {
  const list  = $("chats-list");
  const noMsg = $("no-chats-msg");
  [...list.children].forEach(c => { if (c.id !== "no-chats-msg") c.remove(); });
  if (!chats.length) { noMsg.style.display = "flex"; return; }
  noMsg.style.display = "none";
  chats.forEach(chat => {
    const otherId   = chat.members.find(m => m !== currentUser.uid);
    const otherName = chat.memberNames?.[otherId] || "User";
    const lastMsg   = chat.lastMessage || "";
    const timeStr   = fmtChatTime(chat.lastMessageTime);
    const isActive  = chat.id === currentChatId;
    const div = document.createElement("div");
    div.className = "chat-item" + (isActive ? " active" : "");
    div.id        = "ci-" + chat.id;
    div.innerHTML = `
      <div class="c-avatar" style="${avatarStyle(otherId)};flex-shrink:0">${initials(otherName)}</div>
      <div class="chat-info">
        <div class="chat-info-top">
          <span class="c-name">${esc(otherName)}</span>
          <span class="c-time">${timeStr}</span>
        </div>
        <div class="c-last-msg">
          ${lastMsg
            ? `<i class="fa-solid fa-check-double"></i>${esc(lastMsg)}`
            : "<em>Start the conversation…</em>"}
        </div>
      </div>`;
    div.onclick = () => openChat(otherId, otherName);
    list.appendChild(div);
  });
}
window.filterChats = function() {
  const q = $("chat-search").value.toLowerCase();
  if (!q) { renderChatsList(allChats); return; }
  renderChatsList(allChats.filter(c => {
    const oid  = c.members.find(m => m !== currentUser.uid);
    const name = (c.memberNames?.[oid] || "").toLowerCase();
    return name.includes(q);
  }));
};
// ════════════════════════════════════════════════════════════
//  OPEN / START CHAT
// ════════════════════════════════════════════════════════════
window.startChat = async function(uid, name) {
  if (!uid || !currentUser) return;
  if (uid === currentUser.uid) {
    showToast("You cannot start a chat with yourself.");
    return;
  }

  try {
    await openChat(uid, name);
    const panel = $("new-conv-panel");
    if (panel?.classList.contains("open")) panel.classList.remove("open");
  } catch (err) {
    console.error("Start chat error:", err);
    showToast("Could not open chat. Deploy Firestore rules and try again.");
  }
};
async function openChat(contactUid, contactName) {
  if (!currentUser) throw new Error("No signed-in user.");
  if (!contactUid) throw new Error("Missing contact uid.");

  currentContactId = contactUid;
  currentChatId    = await getOrCreateChat(
    currentUser.uid,
    currentUser.displayName || "NexUser",
    contactUid,
    contactName
  );
  // Fetch contact data
  const cData = await getUserData(contactUid) || {};
  const displayName = cData.name || contactName || "NexUser";
  // Update header
  $("chat-h-name").textContent = displayName;
  const statusEl = $("chat-h-status");
  if (cData.online) {
    statusEl.textContent = "online";
    statusEl.className   = "chat-h-status online";
  } else {
    statusEl.textContent = "last seen " + fmtLastSeen(cData.lastSeen);
    statusEl.className   = "chat-h-status";
  }
  const hav = $("chat-h-av");
  hav.textContent   = initials(displayName);
  hav.style.cssText = avatarStyle(contactUid) + ";width:40px;height:40px;border-radius:12px;font-size:15px";
  // Show active chat view
  $("chat-empty").style.display  = "none";
  $("active-chat").style.display = "flex";
  // Watch contact's live status
  watchContactStatus(contactUid, data => {
    if (currentContactId !== contactUid) return;
    statusEl.textContent = data.online ? "online" : "last seen " + fmtLastSeen(data.lastSeen);
    statusEl.className   = "chat-h-status" + (data.online ? " online" : "");
  });
  // Highlight in sidebar
  document.querySelectorAll(".chat-item").forEach(el => el.classList.remove("active"));
  const ci = $("ci-" + currentChatId);
  if (ci) ci.classList.add("active");
  // Mobile: show chat area
  if (window.innerWidth <= 720) $("chat-area").classList.add("mobile-active");
  // Start listening to messages
  startMessagesListener(currentChatId);
}

// ════════════════════════════════════════════════════════════
//  MESSAGES — Callback from firebase.js
// ════════════════════════════════════════════════════════════
export function onMessagesUpdate(msgs) {
  const area = $("messages-area");
  area.innerHTML = "";
  let lastDateLabel = "";
  msgs.forEach(msg => {
    const dLabel = fmtDateLabel(msg.timestamp);
    if (dLabel !== lastDateLabel) {
      lastDateLabel = dLabel;
      const sep = document.createElement("div");
      sep.className = "date-sep";
      sep.innerHTML = `<span>${dLabel}</span>`;
      area.appendChild(sep);
    }
    area.appendChild(buildBubble(msg));
  });
  if (!msgs.length) {
    area.innerHTML = '<div class="date-sep"><span>Send your first message ⚡</span></div>';
  }
  // Restore typing indicator at bottom
  const tb = $("typing-bubble");
  if (tb) area.appendChild(tb);
  area.scrollTop = area.scrollHeight;
}
function buildBubble(msg) {
  const isOut = msg.senderId === currentUser.uid;
  const wrap  = document.createElement("div");
  wrap.className = "msg-wrap " + (isOut ? "out" : "in");
  wrap.innerHTML = `
    <div class="bubble">
      ${isOut
        ? '<div class="bubble-tail-out"></div>'
        : '<div class="bubble-tail-in"></div>'}
      <div class="bubble-text">${esc(msg.text)}</div>
      <div class="bubble-meta">
        <span class="b-time">${fmtTime(msg.timestamp)}</span>
        ${isOut ? '<span class="b-ticks"><i class="fa-solid fa-check-double"></i></span>' : ""}
      </div>
    </div>`;
  return wrap;
}
// ════════════════════════════════════════════════════════════
//  SEND MESSAGE
// ════════════════════════════════════════════════════════════
window.sendMessage = async function() {
  const inp  = $("message-input");
  const text = inp.value.trim();
  if (!text || !currentChatId) return;
  inp.value = "";
  autoGrow(inp);
  try {
    await sendMsg(
      currentChatId,
      currentUser.uid,
      currentUser.displayName || "NexUser",
      text
    );
  } catch (e) {
    console.error("Send message error:", e);
    showToast("Failed to send. Check Firestore rules or connection.");
  }
};
window.onMsgKey = function(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
};
window.autoGrow = function(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
};
// ════════════════════════════════════════════════════════════
//  PANEL TOGGLES
// ════════════════════════════════════════════════════════════
window.toggleProfile = function() {
  $("profile-panel").classList.toggle("open");
};
window.toggleNewConv = function() {
  const panel = $("new-conv-panel");
  panel.classList.toggle("open");
  if (panel.classList.contains("open")) {
    loadAllUsersData(currentUser?.uid);
    $("user-search-inp").value = "";
  }
};
window.closeMobileChat = function() {
  $("chat-area").classList.remove("mobile-active");
};