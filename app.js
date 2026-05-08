import {
  signUp,
  signIn,
  logOut,
  getUserData,
  getOrCreateChat,
  startMessagesListener,
  sendMsg,
  sendFileMsg,
  sendGifMsg,
  watchContactStatus,
  findUserByPublicId,
  searchUsersByQuery,
  updateUserProfilePhoto,
  updateUserDisplayName,
  startIncomingCallsListener,
  stopIncomingCallsListener,
  createCall,
  answerCall,
  updateCallStatus,
  addIceCandidateToCall,
  listenCallDoc,
  listenIceCandidates,
  deleteMessages,
  deleteMessagesForMe,
  deleteMessagesForEveryone,
  markMessagesSeen,
  deleteWholeChat,
  blockContact,
  isContactBlocked,
  stopMessagesListener,
  friendlyErr
} from "./firebase.js";
import { GIPHY_CONFIG } from "./config/config.js";
let currentUser      = null;
let currentChatId    = null;
let currentContactId = null;
let allChats         = [];
let allUsers         = [];
let userSearchTimer  = null;
let incomingCallData = null;
let activeCallId     = null;
let activeCallType   = null;
let peerConnection   = null;
let localStream      = null;
let remoteStream     = null;
let callUnsubs       = [];
let pendingIce       = [];
let currentCallRole  = null;
let isMuted          = false;
let isCameraOff      = false;
let cameraStream     = null;
let currentMessages  = [];
let chatSearchQuery  = "";
let selectionMode    = false;
let selectedMessageIds = new Set();
let currentContactData = null;
let contactBlocked   = false;
let chatsSeenOnce    = false;
let lastChatNotifyMap = new Map();
let ringTimer        = null;
let ringAudioCtx     = null;
let renderFrame      = null;
let seenTimer        = null;
let giphySearchTimer = null;
let selectedGif      = null;
let signupProfilePhotoFile = null;
let profileCropTarget = null;
let profileCropImage = null;
let profileCropScale = 1;
let profileCropOffset = { x: 0, y: 0 };
let profileCropDrag = null;
let chatSearchTimer = null;
let contactCache     = new Map();
let chatRenderVersion = 0;
let messagesDelegated = false;
let lastMessageRenderSignature = "";
const MAX_RENDER_SIGNATURE_ITEMS = 500;
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};
const domCache = new Map();
const $ = id => {
  if (!id) return null;
  let el = domCache.get(id);
  if (!el || !el.isConnected) {
    el = document.getElementById(id);
    if (el) domCache.set(id, el);
  }
  return el;
};
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
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
const fmtCache = new Map();
const timeFmt = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
const chatDateFmt = new Intl.DateTimeFormat([], { day: "2-digit", month: "short" });
const dateLabelFmt = new Intl.DateTimeFormat([], { weekday: "long", month: "short", day: "numeric" });
const lastSeenFmt = new Intl.DateTimeFormat([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
function dateFromTs(ts) {
  if (!ts) return null;
  return ts.toDate ? ts.toDate() : new Date(ts);
}
function tsKey(ts) {
  const d = dateFromTs(ts);
  return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
}
function cachedFmt(prefix, ts, compute) {
  const key = `${prefix}:${tsKey(ts)}`;
  if (fmtCache.has(key)) return fmtCache.get(key);
  const value = compute();
  if (fmtCache.size > 900) fmtCache.clear();
  fmtCache.set(key, value);
  return value;
}
function dayDiffFromNow(d) {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.floor((today - start) / 86400000);
}
function fmtTime(ts) {
  if (!ts) return "";
  return cachedFmt("time", ts, () => timeFmt.format(dateFromTs(ts)));
}
function fmtChatTime(ts) {
  if (!ts) return "";
  return cachedFmt("chat", ts, () => {
    const d = dateFromTs(ts);
    const diff = dayDiffFromNow(d);
    if (diff === 0) return fmtTime(ts);
    if (diff === 1) return "Yesterday";
    return chatDateFmt.format(d);
  });
}
function fmtDateLabel(ts) {
  if (!ts) return "Today";
  return cachedFmt("label", ts, () => {
    const d = dateFromTs(ts);
    const diff = dayDiffFromNow(d);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return dateLabelFmt.format(d);
  });
}
function fmtLastSeen(ts) {
  if (!ts) return "a while ago";
  return cachedFmt("seen", ts, () => lastSeenFmt.format(dateFromTs(ts)));
}
function userIsOnline(user = {}) {
  if (!user.lastActive) return false;
  const d = user.lastActive.toDate ? user.lastActive.toDate() : new Date(user.lastActive);
  return !!user.online && (Date.now() - d.getTime()) < 90000;
}
function formatFileSize(bytes = 0) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(bytes);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
function safeLink(url = "") {
  const u = String(url || "");
  return /^https:\/\//i.test(u) ? esc(u) : "#";
}
function rawSafeUrl(url = "") {
  const u = String(url || "");
  return /^https:\/\//i.test(u) ? u : "";
}
function userPhotoURL(userOrUrl = "") {
  if (!userOrUrl) return "";
  if (typeof userOrUrl === "string") return rawSafeUrl(userOrUrl);
  const candidates = [
    userOrUrl.photoURL,
    userOrUrl.profilePhotoURL,
    userOrUrl.profilePhoto,
    userOrUrl.profilePic,
    userOrUrl.avatarUrl,
    userOrUrl.avatarURL
  ];
  return rawSafeUrl(candidates.find(Boolean) || "");
}
function cloudinaryDownloadUrl(url = "", name = "nexchat-file") {
  const raw = rawSafeUrl(url);
  if (!raw) return "";
  if (!raw.includes("res.cloudinary.com") || !raw.includes("/upload/")) return raw;
  const baseName = String(name || "nexchat-file")
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 80) || "nexchat-file";
  return raw.replace("/upload/", `/upload/fl_attachment:${encodeURIComponent(baseName)}/`);
}
function avatarHTML(name = "", photoURL = "") {
  const url = rawSafeUrl(photoURL);
  return url ? `<img src="${esc(url)}" alt="${esc(name || "Profile picture")}" loading="lazy" decoding="async"/>` : esc(initials(name));
}
function avatarClass(photoURL = "") {
  return rawSafeUrl(photoURL) ? " has-photo" : "";
}
function applyAvatar(el, uid, name, photoURL, extraCss = "") {
  if (!el) return;
  const url = rawSafeUrl(photoURL);
  el.classList.toggle("has-photo", !!url);
  el.style.cssText = (url ? "" : avatarStyle(uid)) + extraCss;
  el.innerHTML = avatarHTML(name, url);
}
function publicUserId(user = {}) {
  const uid = String(user.uid || user.id || "");
  return String(user.nexId || (uid ? `NEX-${uid.slice(0, 10).toUpperCase()}` : "NEX-USER"));
}
function isRealDisplayName(value = "") {
  const name = String(value || "").trim();
  return !!name && name.toLowerCase() !== "nexuser";
}
function fallbackNameFromEmail(email = "") {
  const local = String(email || "").split("@")[0].trim();
  if (!local) return "";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}
function displayUserName(user = {}, fallback = "NexUser") {
  if (isRealDisplayName(user.name)) return String(user.name).trim();
  if (isRealDisplayName(user.displayName)) return String(user.displayName).trim();
  const emailName = fallbackNameFromEmail(user.email);
  if (emailName) return emailName;
  if (isRealDisplayName(fallback)) return String(fallback).trim();
  return fallbackNameFromEmail(user.fallbackEmail) || "NexUser";
}
function rememberContact(user = {}) {
  const id = user.uid || user.id;
  if (!id) return null;
  const merged = { ...(contactCache.get(id) || {}), ...user, id, uid: id };
  merged.name = displayUserName(merged, merged.name || merged.displayName || merged.email || "NexUser");
  const photo = userPhotoURL(merged);
  if (photo) merged.photoURL = photo;
  contactCache.set(id, merged);
  return merged;
}
function cachedContactName(uid = "", fallback = "NexUser") {
  const cached = uid ? contactCache.get(uid) : null;
  return displayUserName(cached || {}, fallback);
}
function refreshContactCache(uid, fallback = "NexUser") {
  if (!uid || contactCache.has(uid)) return Promise.resolve(contactCache.get(uid));
  return getUserData(uid)
    .then(data => data ? rememberContact({ ...data, id: uid, uid, fallbackName: fallback }) : null)
    .catch(err => { console.warn("Could not refresh contact profile:", err); return null; });
}
function matchUserSearch(user, q) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return false;
  const fields = [
    user.name, user.displayName, user.email, user.uid, user.id, user.nexId, publicUserId(user)
  ].map(v => String(v || "").toLowerCase());
  return fields.some(v => v && (v.includes(needle) || needle.includes(v)));
}
function triggerLocalDownload(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "nexchat-file";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function escapeRegExp(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function highlightEsc(text = "", query = "") {
  const safe = esc(text);
  const q = String(query || "").trim();
  if (!q) return safe;
  const parts = q.split(/\s+/).filter(Boolean).slice(0, 6).map(escapeRegExp);
  if (!parts.length) return safe;
  const re = new RegExp(`(${parts.join("|")})`, "ig");
  return safe.replace(re, '<mark class="msg-highlight">$1</mark>');
}
function messageMatchesSearch(msg, query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const hay = [
    msg.text, msg.fileName, msg.senderName, msg.type, fmtDateLabel(msg.timestamp), fmtTime(msg.timestamp)
  ].map(v => String(v || "").toLowerCase()).join(" ");
  return q.split(/\s+/).filter(Boolean).every(part => hay.includes(part));
}
function closeFloatingPanels() {
  $("chat-menu")?.classList.remove("show");
}
function updateComposerState() {
  const blocked = !!contactBlocked;
  const input = $("message-input");
  const send = $("send-btn");
  const attach = $("attach-btn");
  const camera = $("camera-send-btn");
  const gif = $("gif-btn");
  [input, send, attach, camera, gif].forEach(el => {
    if (!el) return;
    el.disabled = blocked;
    el.classList.toggle("disabled", blocked);
  });
  if (input) input.placeholder = blocked ? "Messaging is disabled because this contact is blocked." : "Message…";
}
function resetActiveChatUI() {
  currentChatId = null;
  currentContactId = null;
  currentContactData = null;
  currentMessages = [];
  lastMessageRenderSignature = "";
  chatSearchQuery = "";
  selectionMode = false;
  selectedMessageIds.clear();
  contactBlocked = false;
  stopMessagesListener?.();
  $("active-chat").style.display = "none";
  $("chat-empty").style.display = "flex";
  $("chat-search-panel")?.classList.remove("show");
  $("message-select-bar")?.classList.remove("show");
  $("chat-menu")?.classList.remove("show");
  closeGifPicker?.();
  updateComposerState();
  document.querySelectorAll(".chat-item").forEach(el => el.classList.remove("active"));
}
function applyTheme(theme = "dark") {
  const clean = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = clean;
  localStorage.setItem("nexchat-theme", clean);
  const icon = $("theme-toggle-icon");
  const btn = $("theme-toggle-btn");
  if (icon) icon.className = clean === "light" ? "fa-solid fa-moon" : "fa-solid fa-sun";
  if (btn) btn.title = clean === "light" ? "Switch to dark mode" : "Switch to light mode";
}
function initTheme() {
  const saved = localStorage.getItem("nexchat-theme");
  const preferred = window.matchMedia?.("(prefers-color-scheme: light)")?.matches ? "light" : "dark";
  applyTheme(saved || preferred);
}
window.toggleTheme = function() {
  applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
};
initTheme();
window.showToast = function(msg, ms = 3000) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), ms);
};
function playNotifyTone(kind = "message") {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = kind === "call" ? 880 : 620;
    gain.gain.value = 0.035;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close?.(); }, kind === "call" ? 260 : 160);
    if (navigator.vibrate) navigator.vibrate(kind === "call" ? [180, 80, 180] : 120);
  } catch (_) {}
}
function startRingTone() {
  stopRingTone();
  playNotifyTone("call");
  ringTimer = setInterval(() => playNotifyTone("call"), 1400);
}
function stopRingTone() {
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
  try { ringAudioCtx?.close?.(); } catch (_) {}
  ringAudioCtx = null;
}
function maybeNotifyChat(chat) {
  if (!currentUser || !chat || !chat.id) return;
  const ts = chat.lastMessageTime?.toMillis ? chat.lastMessageTime.toMillis() : (chat.lastMessageTime ? new Date(chat.lastMessageTime).getTime() : 0);
  const prev = lastChatNotifyMap.get(chat.id) || 0;
  lastChatNotifyMap.set(chat.id, ts || prev);
  if (!chatsSeenOnce || !ts || ts <= prev) return;
  if (chat.lastSenderId === currentUser.uid) return;
  const otherId = chat.members?.find?.(m => m !== currentUser.uid) || "";
  const otherName = chat.memberNames?.[otherId] || chat.lastSenderName || "NexChat User";
  const body = chat.lastMessage || "New message";
  if (currentChatId !== chat.id || document.hidden) {
    showToast(`New message from ${otherName}`);
    playNotifyTone("message");
  }
}

function showErr(elId, msg) {
  const el = $(elId);
  el.textContent = msg;
  el.style.display = "block";
}
function clearErr(elId) {
  $(elId).style.display = "none";
}
export function onAuthReady(user, isLoggedIn) {
  $("loading-screen").style.display = "none";
  if (isLoggedIn && user) {
    currentUser = user;
    $("auth-screen").style.display = "none";
    $("app-screen").style.display  = "block";
    initAppUI();
    startIncomingCallsListener(user.uid, handleIncomingCall);
    renderUserSearchHint();
  } else {
    stopIncomingCallsListener();
    cleanupCall(false);
    currentUser   = null;
    currentChatId = null;
    $("auth-screen").style.display = "flex";
    $("app-screen").style.display  = "none";
  }
}
async function initAppUI() {
  bindMessageAreaDelegation();
  const name = displayUserName({ displayName: currentUser.displayName, email: currentUser.email, uid: currentUser.uid }, "NexUser");
  const photoURL = userPhotoURL(currentUser) || "";
  applyAvatar($("profile-av-big"), currentUser.uid, name, photoURL);
  $("profile-disp-name").textContent  = name;
  $("profile-disp-email").textContent = currentUser.email;
  if ($("profile-user-id")) $("profile-user-id").textContent = publicUserId({ uid: currentUser.uid });
  if (currentUser.metadata?.creationTime) {
    const d = new Date(currentUser.metadata.creationTime);
    $("profile-since").textContent = d.toLocaleDateString([], {
      month: "long", day: "numeric", year: "numeric"
    });
  }
  try {
    const fresh = await getUserData(currentUser.uid);
    if (fresh) {
      const freshName = displayUserName({ ...fresh, id: currentUser.uid, uid: currentUser.uid, email: currentUser.email, displayName: currentUser.displayName }, name);
      rememberContact({ ...fresh, id: currentUser.uid, uid: currentUser.uid, name: freshName });
      const freshPhoto = userPhotoURL(fresh) || photoURL;
      applyAvatar($("profile-av-big"), currentUser.uid, freshName, freshPhoto);
      $("profile-disp-name").textContent = freshName;
      if ($("profile-user-id")) $("profile-user-id").textContent = publicUserId({ ...fresh, uid: currentUser.uid });
    }
  } catch (err) {
    console.warn("Could not refresh profile data:", err);
  }
}
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
    await signUp(name, email, pass, signupProfilePhotoFile);
    signupProfilePhotoFile = null;
    updateSignupPhotoPreview(null);
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
function renderUserSearchHint(message) {
  const list = $("users-list");
  if (!list) return;
  list.innerHTML = `
    <div class="no-chats-msg user-search-hint">
      <i class="fa-solid fa-id-card"></i>
      <p>${esc(message || "Search by NexChat ID, email, or name to find a user.")}<br/>Users are hidden until you search.</p>
    </div>`;
}
function renderUsersList(users, hasQuery = false) {
  const list = $("users-list");
  if (!list) return;

  if (!hasQuery) {
    renderUserSearchHint();
    return;
  }

  const safeUsers = (users || [])
    .filter(u => u && u.id && u.id !== currentUser?.uid && u.uid !== currentUser?.uid)
    .filter(u => String(u.email || "").toLowerCase() !== String(currentUser?.email || "").toLowerCase());

  if (!safeUsers.length) {
    list.innerHTML = `<div class="no-chats-msg"><i class="fa-solid fa-user-slash"></i><p>No user found.<br/>Ask the person for their NexChat ID or registered email.</p></div>`;
    return;
  }

  list.innerHTML = "";
  const userFrag = document.createDocumentFragment();

  safeUsers.forEach(rawUser => {
    const u = rememberContact(rawUser) || rawUser;
    const name  = displayUserName(u);
    const email = String(u.email || "");
    const nexId = publicUserId(u);
    const photoURL = userPhotoURL(u);

    const item = document.createElement("button");
    item.type = "button";
    item.className = "user-item";
    item.setAttribute("aria-label", `Start chat with ${name}`);
    const hasPhoto = !!photoURL;
    item.innerHTML = `
      <div class="c-avatar${avatarClass(photoURL)}" style="${hasPhoto ? "" : avatarStyle(u.id)};width:44px;height:44px;border-radius:13px;font-size:16px">
        ${avatarHTML(name, photoURL)}
        <div class="status-dot${userIsOnline(u) ? "" : " offline"}"></div>
      </div>
      <div class="user-item-text">
        <div class="user-item-name">${esc(name)}</div>
        <div class="user-item-email">${esc(email)}</div>
        <div class="user-item-id">ID: ${esc(nexId)}</div>
      </div>
      <button type="button" class="mini-profile-btn" title="View profile">View</button>
      ${userIsOnline(u) ? '<div class="user-online-tag">● ONLINE</div>' : ""}
    `;
    item.addEventListener("click", () => startChat(u.id, name));
    item.querySelector(".mini-profile-btn")?.addEventListener("click", e => {
      e.stopPropagation();
      showUserProfile(u.id);
    });
    userFrag.appendChild(item);
  });
  list.appendChild(userFrag);
}

window.filterUsers = function() {
  const q = $("user-search-inp").value.trim();
  if (userSearchTimer) clearTimeout(userSearchTimer);
  if (!q) {
    renderUserSearchHint();
    return;
  }
  if (q.length < 2) {
    renderUserSearchHint("Type at least 2 characters of their name, email, or NexChat ID.");
    return;
  }

  const list = $("users-list");
  if (list) list.innerHTML = '<div class="spinner"></div>';
  userSearchTimer = setTimeout(async () => {
    try {
      let users = await searchUsersByQuery(q, currentUser?.uid);
      if (!users.length) {
        const exact = await findUserByPublicId(q, currentUser?.uid).catch(() => null);
        users = exact ? [exact] : [];
      }
      renderUsersList(users, true);
    } catch (err) {
      console.error("User search error:", err);
      renderUsersList([], true);
    }
  }, 250);
};
window.copyMyId = async function() {
  const id = publicUserId({ uid: currentUser?.uid });
  try {
    await navigator.clipboard.writeText(id);
    showToast("NexChat ID copied ✅");
  } catch {
    showToast(`Your NexChat ID: ${id}`, 5000);
  }
};
export function onChatsUpdate(chats) {
  allChats = Array.isArray(chats) ? chats : [];
  allChats.forEach(maybeNotifyChat);
  chatsSeenOnce = true;
  renderChatsList(allChats);
}

function chatContactSummary(chat) {
  const otherId = chat.members?.find(m => m !== currentUser?.uid) || "";
  const memberName = chat.memberNames?.[otherId] || "";
  const cached = otherId ? contactCache.get(otherId) : null;
  const fallback = isRealDisplayName(memberName) ? memberName : "NexUser";
  const name = displayUserName(cached || { name: memberName }, fallback);
  const photoURL = userPhotoURL(cached || {}) || userPhotoURL(chat.memberPhotos?.[otherId] || "");
  return { otherId, name, photoURL, cached };
}

function refreshChatContactInList(chat, version) {
  const otherId = chat.members?.find(m => m !== currentUser?.uid);
  if (!otherId) return;
  refreshContactCache(otherId, chat.memberNames?.[otherId] || "NexUser").then(user => {
    if (!user || version !== chatRenderVersion) return;
    const item = $("ci-" + chat.id);
    if (!item) return;
    const name = displayUserName(user, chat.memberNames?.[otherId] || "NexUser");
    const nameEl = item.querySelector(".c-name");
    if (nameEl) nameEl.textContent = name;
    const avatar = item.querySelector(".c-avatar");
    if (avatar) applyAvatar(avatar, otherId, name, userPhotoURL(user), ";flex-shrink:0");
  });
}

function renderChatsList(chats) {
  const list  = $("chats-list");
  const noMsg = $("no-chats-msg");
  if (!list || !noMsg) return;
  chatRenderVersion += 1;
  const version = chatRenderVersion;
  if (!chats.length) {
    noMsg.style.display = "flex";
    list.replaceChildren(noMsg);
    return;
  }
  noMsg.style.display = "none";
  const chatFrag = document.createDocumentFragment();
  const refreshQueue = [];
  chats.forEach(chat => {
    const { otherId, name: otherName, photoURL } = chatContactSummary(chat);
    if (!otherId) return;
    const lastMsg   = chat.lastMessage || "";
    const timeStr   = fmtChatTime(chat.lastMessageTime);
    const isActive  = chat.id === currentChatId;
    const div = document.createElement("div");
    div.className = "chat-item" + (isActive ? " active" : "");
    div.id        = "ci-" + chat.id;
    const hasPhoto = !!rawSafeUrl(photoURL);
    div.innerHTML = `
      <div class="c-avatar${avatarClass(photoURL)}" style="${hasPhoto ? "" : avatarStyle(otherId)};flex-shrink:0">${avatarHTML(otherName, photoURL)}</div>
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
    div.onclick = () => openChat(otherId, cachedContactName(otherId, otherName));
    chatFrag.appendChild(div);
    refreshQueue.push(chat);
  });
  list.replaceChildren(noMsg, chatFrag);
  refreshQueue.forEach(chat => refreshChatContactInList(chat, version));
}
window.filterChats = function() {
  const q = $("chat-search").value.toLowerCase();
  if (!q) { renderChatsList(allChats); return; }
  renderChatsList(allChats.filter(c => {
    const oid  = c.members.find(m => m !== currentUser.uid);
    const cached = oid ? contactCache.get(oid) : null;
    const name = displayUserName(cached || { name: c.memberNames?.[oid] || "", email: cached?.email || "" }, c.memberNames?.[oid] || "").toLowerCase();
    const last = String(c.lastMessage || "").toLowerCase();
    return name.includes(q) || last.includes(q);
  }));
};
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
  const cData = await getUserData(contactUid) || {};
  rememberContact({ ...cData, id: contactUid, uid: contactUid });
  const contactDisplayForChat = displayUserName({ ...cData, id: contactUid, uid: contactUid }, contactName || "NexUser");
  const myData = await getUserData(currentUser.uid).catch(() => null);
  if (myData) rememberContact({ ...myData, id: currentUser.uid, uid: currentUser.uid });
  const myDisplayForChat = displayUserName({ ...(myData || {}), id: currentUser.uid, uid: currentUser.uid, email: currentUser.email, displayName: currentUser.displayName }, currentUser.displayName || currentUser.email || "NexUser");
  currentChatId    = await getOrCreateChat(
    currentUser.uid,
    myDisplayForChat,
    contactUid,
    contactDisplayForChat
  );
  currentContactData = cData;
  const blockState = await isContactBlocked(currentUser.uid, contactUid).catch(() => ({ iBlocked: false, theyBlocked: false, blocked: false }));
  contactBlocked = !!blockState.blocked;
  const displayName = displayUserName({ ...cData, id: contactUid, uid: contactUid }, contactDisplayForChat || contactName || "NexUser");
  $("chat-h-name").textContent = displayName;
  const statusEl = $("chat-h-status");
  if (userIsOnline(cData)) {
    statusEl.textContent = "online";
    statusEl.className   = "chat-h-status online";
  } else {
    statusEl.textContent = "last seen " + fmtLastSeen(cData.lastSeen || cData.lastActive);
    statusEl.className   = "chat-h-status";
  }
  const hav = $("chat-h-av");
  applyAvatar(hav, contactUid, displayName, userPhotoURL(cData), ";width:40px;height:40px;border-radius:12px;font-size:15px");
  $("chat-empty").style.display  = "none";
  $("active-chat").style.display = "flex";
  watchContactStatus(contactUid, data => {
    if (currentContactId !== contactUid) return;
    const live = userIsOnline(data);
    statusEl.textContent = live ? "online" : "last seen " + fmtLastSeen(data.lastSeen || data.lastActive);
    statusEl.className   = "chat-h-status" + (live ? " online" : "");
  });
  document.querySelectorAll(".chat-item").forEach(el => el.classList.remove("active"));
  const ci = $("ci-" + currentChatId);
  if (ci) ci.classList.add("active");
  if (window.innerWidth <= 720) $("chat-area").classList.add("mobile-active");
  chatSearchQuery = "";
  selectionMode = false;
  selectedMessageIds.clear();
  $("chat-search-panel")?.classList.remove("show");
  if ($("chat-search-input")) $("chat-search-input").value = "";
  updateSelectionToolbar();
  updateComposerState();
  lastMessageRenderSignature = "";
  startMessagesListener(currentChatId);
}

export function onMessagesUpdate(msgs) {
  currentMessages = Array.isArray(msgs) ? msgs : [];
  scheduleSeenMark();
  scheduleRenderMessages();
}

function scheduleRenderMessages() {
  if (renderFrame) cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    renderMessages();
  });
}

function visibleMessages() {
  return currentMessages.filter(msg => !(Array.isArray(msg.deletedFor) && msg.deletedFor.includes(currentUser?.uid)));
}

function messageSeenByContact(msg) {
  return !!currentContactId && Array.isArray(msg.seenBy) && msg.seenBy.includes(currentContactId);
}

function scheduleSeenMark() {
  if (seenTimer) clearTimeout(seenTimer);
  seenTimer = setTimeout(async () => {
    if (!currentChatId || !currentUser || document.hidden) return;
    const ids = currentMessages
      .filter(msg => msg.senderId !== currentUser.uid)
      .filter(msg => !(Array.isArray(msg.deletedFor) && msg.deletedFor.includes(currentUser.uid)))
      .filter(msg => !(Array.isArray(msg.seenBy) && msg.seenBy.includes(currentUser.uid)))
      .map(msg => msg.id)
      .filter(Boolean);
    if (!ids.length) return;
    await markMessagesSeen(currentChatId, currentUser.uid, ids);
  }, 350);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleSeenMark();
});

function messageRenderSignature(messages, q) {
  const selectedKey = selectionMode ? [...selectedMessageIds].sort().join(",") : "";
  const parts = messages.slice(-MAX_RENDER_SIGNATURE_ITEMS).map(msg => [
    msg.id,
    msg.senderId,
    msg.type,
    msg.text,
    msg.fileUrl,
    msg.fileName,
    msg.timestamp?.seconds || tsKey(msg.timestamp),
    Array.isArray(msg.seenBy) ? msg.seenBy.join(",") : "",
    Array.isArray(msg.deletedFor) ? msg.deletedFor.join(",") : ""
  ].join("~"));
  return [currentChatId, q, selectionMode ? "1" : "0", selectedKey, messages.length, parts.join("|")].join("||");
}

function bindMessageAreaDelegation() {
  const area = $("messages-area");
  if (!area || messagesDelegated) return;
  messagesDelegated = true;
  area.addEventListener("click", e => {
    const downloadBtn = e.target.closest?.(".msg-download-btn");
    if (downloadBtn) {
      e.preventDefault();
      e.stopPropagation();
      downloadAttachment(downloadBtn.dataset.downloadUrl, downloadBtn.dataset.downloadName);
      return;
    }
    const wrap = e.target.closest?.(".msg-wrap");
    if (!wrap || !selectionMode) return;
    if (e.target.closest("a")) return;
    window.toggleMessageSelection(wrap.dataset.messageId);
  });
}

function renderMessages() {
  const area = $("messages-area");
  if (!area) return;
  const shouldStick = area.scrollHeight - area.scrollTop - area.clientHeight < 180;

  const q = String(chatSearchQuery || "").trim();
  const baseMsgs = visibleMessages();
  const displayMsgs = q
    ? baseMsgs.filter(msg => messageMatchesSearch(msg, q))
    : baseMsgs;

  const signature = messageRenderSignature(displayMsgs, q);
  if (signature === lastMessageRenderSignature) return;
  lastMessageRenderSignature = signature;

  const frag = document.createDocumentFragment();

  if (q) {
    const note = document.createElement("div");
    note.className = "search-result-note";
    note.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> ${displayMsgs.length} result${displayMsgs.length === 1 ? "" : "s"} for <strong>${esc(q)}</strong>`;
    frag.appendChild(note);
  }

  let lastDateLabel = "";
  for (const msg of displayMsgs) {
    const dLabel = fmtDateLabel(msg.timestamp);
    if (dLabel !== lastDateLabel) {
      lastDateLabel = dLabel;
      const sep = document.createElement("div");
      sep.className = "date-sep";
      sep.innerHTML = `<span>${dLabel}</span>`;
      frag.appendChild(sep);
    }
    frag.appendChild(buildBubble(msg));
  }

  if (!displayMsgs.length) {
    const sep = document.createElement("div");
    sep.className = "date-sep";
    sep.innerHTML = q ? '<span>No matching message found</span>' : '<span>Send your first message ⚡</span>';
    frag.appendChild(sep);
  }

  const tb = $("typing-bubble");
  area.replaceChildren(frag);
  if (tb) area.appendChild(tb);
  if (shouldStick || !q) area.scrollTop = area.scrollHeight;
}

function updateSelectionToolbar() {
  const bar = $("message-select-bar");
  if (!bar) return;
  bar.classList.toggle("show", !!selectionMode);
  const count = selectedMessageIds.size;
  if ($("selected-count")) $("selected-count").textContent = `${count} selected`;
  const btn = $("delete-selected-btn");
  const btnAll = $("delete-everyone-btn");
  if (btn) btn.disabled = count === 0;
  if (btnAll) btnAll.disabled = count === 0;
}

window.toggleSelectMode = function(force) {
  selectionMode = typeof force === "boolean" ? force : !selectionMode;
  selectedMessageIds.clear();
  closeFloatingPanels();
  updateSelectionToolbar();
  renderMessages();
};

window.toggleMessageSelection = function(messageId) {
  if (!selectionMode || !messageId) return;
  if (selectedMessageIds.has(messageId)) selectedMessageIds.delete(messageId);
  else selectedMessageIds.add(messageId);
  const el = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (el) el.classList.toggle("selected", selectedMessageIds.has(messageId));
  updateSelectionToolbar();
};

async function finishDeleteSelection(action) {
  selectedMessageIds.clear();
  selectionMode = false;
  updateSelectionToolbar();
  scheduleRenderMessages();
  showToast(action === "everyone" ? "Deleted for everyone ✅" : "Deleted for you ✅");
}

window.deleteSelectedForMe = async function() {
  if (!currentChatId || selectedMessageIds.size === 0 || !currentUser) return;
  if (!confirm(`Delete ${selectedMessageIds.size} selected message(s) only for you?`)) return;
  try {
    await deleteMessagesForMe(currentChatId, currentUser.uid, [...selectedMessageIds]);
    await finishDeleteSelection("me");
  } catch (err) {
    console.error("Delete for me error:", err);
    showToast("Could not delete for you. Deploy updated Firestore rules.");
  }
};

window.deleteSelectedForEveryone = async function() {
  if (!currentChatId || selectedMessageIds.size === 0) return;
  const chosen = currentMessages.filter(m => selectedMessageIds.has(m.id));
  const hasOtherMessages = chosen.some(m => m.senderId !== currentUser?.uid);
  const msg = hasOtherMessages
    ? "Some selected messages were sent by the other user. Delete selected messages for everyone?"
    : `Delete ${selectedMessageIds.size} selected message(s) for everyone?`;
  if (!confirm(msg)) return;
  try {
    await deleteMessagesForEveryone(currentChatId, [...selectedMessageIds]);
    await finishDeleteSelection("everyone");
  } catch (err) {
    console.error("Delete for everyone error:", err);
    showToast("Could not delete for everyone. Deploy updated Firestore rules.");
  }
};

window.deleteSelectedMessages = window.deleteSelectedForMe;

window.toggleChatSearch = function() {
  const panel = $("chat-search-panel");
  if (!panel) return;
  const willOpen = !panel.classList.contains("show");
  panel.classList.toggle("show", willOpen);
  closeFloatingPanels();
  if (willOpen) {
    $("chat-search-input")?.focus();
  } else {
    chatSearchQuery = "";
    if ($("chat-search-input")) $("chat-search-input").value = "";
    renderMessages();
  }
};

window.filterCurrentChatMessages = function() {
  chatSearchQuery = $("chat-search-input")?.value || "";
  if (chatSearchTimer) clearTimeout(chatSearchTimer);
  chatSearchTimer = setTimeout(() => scheduleRenderMessages(), 120);
};

window.clearChatSearch = function() {
  chatSearchQuery = "";
  if ($("chat-search-input")) $("chat-search-input").value = "";
  $("chat-search-panel")?.classList.remove("show");
  renderMessages();
};

window.toggleChatMenu = function(e) {
  e?.stopPropagation?.();
  const menu = $("chat-menu");
  if (!menu || !currentChatId) return;
  menu.classList.toggle("show");
};

window.deleteCurrentChat = async function() {
  closeFloatingPanels();
  if (!currentChatId) return;
  if (!confirm("Delete this whole chat for both users?")) return;
  try {
    const oldChatId = currentChatId;
    resetActiveChatUI();
    await deleteWholeChat(oldChatId);
    showToast("Chat deleted ✅");
  } catch (err) {
    console.error("Delete whole chat error:", err);
    showToast("Could not delete chat. Deploy updated Firestore rules.");
  }
};

window.blockCurrentContact = async function() {
  closeFloatingPanels();
  if (!currentContactId || !currentUser) return;
  const name = $("chat-h-name")?.textContent || "this contact";
  if (!confirm(`Block ${name}? You will not be able to send messages or call them from this chat.`)) return;
  try {
    await blockContact(currentUser.uid, currentContactId);
    contactBlocked = true;
    updateComposerState();
    showToast("Contact blocked.");
  } catch (err) {
    console.error("Block contact error:", err);
    showToast("Could not block contact. Deploy updated Firestore rules.");
  }
};

// Close menu on outside click
document.addEventListener("click", e => {
  if (!e.target.closest?.("#chat-menu") && !e.target.closest?.("#chat-menu-btn")) {
    $("chat-menu")?.classList.remove("show");
  }
});

function buildAttachment(msg) {
  if (!msg.fileUrl) return "";
  const href = safeLink(msg.fileUrl);
  const name = esc(msg.fileName || msg.gifTitle || "Attachment");
  const size = esc(formatFileSize(msg.fileSize));
  const type = String(msg.fileType || "");
  const downloadUrl = esc(cloudinaryDownloadUrl(msg.fileUrl, msg.fileName || "nexchat-file"));
  const downloadBtn = `
    <button class="msg-download-btn" type="button" data-download-url="${downloadUrl || href}" data-download-name="${name}" title="Download">
      <i class="fa-solid fa-download"></i> Download
    </button>`;

  if (msg.type === "gif") {
    return `
      <a class="msg-image-link gif-link" href="${href}" target="_blank" rel="noopener noreferrer" title="Open GIF">
        <img class="msg-image msg-gif" src="${href}" alt="${name}" loading="lazy" decoding="async"/>
      </a>
      <div class="msg-file-name"><i class="fa-solid fa-film"></i> GIF${msg.gifTitle ? ` · ${esc(msg.gifTitle)}` : ""}</div>
      <div class="msg-media-actions">${downloadBtn}</div>`;
  }

  if (msg.type === "image" || type.startsWith("image/")) {
    return `
      <a class="msg-image-link" href="${href}" target="_blank" rel="noopener noreferrer" title="Open image">
        <img class="msg-image" src="${href}" alt="${name}" loading="lazy" decoding="async"/>
      </a>
      <div class="msg-file-name">${name}${size ? ` · ${size}` : ""}</div>
      <div class="msg-media-actions">${downloadBtn}</div>`;
  }

  return `
    <a class="msg-file-card" href="${href}" target="_blank" rel="noopener noreferrer" title="Open file">
      <i class="fa-solid fa-file-lines"></i>
      <span class="msg-file-meta">
        <strong>${name}</strong>
        ${size ? `<small>${size}</small>` : ""}
      </span>
    </a>
    <div class="msg-media-actions">${downloadBtn}</div>`;
}
function buildBubble(msg) {
  const isOut = msg.senderId === currentUser.uid;
  const seen = isOut && messageSeenByContact(msg);
  const wrap  = document.createElement("div");
  const text  = String(msg.text || "");
  const attachment = buildAttachment(msg);
  const selected = selectedMessageIds.has(msg.id);
  wrap.className = "msg-wrap " + (isOut ? "out" : "in") + (selectionMode ? " selection-mode" : "") + (selected ? " selected" : "");
  wrap.dataset.messageId = msg.id || "";
  wrap.innerHTML = `
    ${selectionMode ? `<button class="msg-select-dot" type="button" title="Select message"><i class="fa-solid fa-check"></i></button>` : ""}
    <div class="bubble${attachment ? " has-attachment" : ""}">
      ${isOut
        ? '<div class="bubble-tail-out"></div>'
        : '<div class="bubble-tail-in"></div>'}
      ${attachment}
      ${text ? `<div class="bubble-text">${highlightEsc(text, chatSearchQuery)}</div>` : ""}
      <div class="bubble-meta">
        <span class="b-time">${fmtTime(msg.timestamp)}</span>
        ${isOut ? `<span class="b-ticks${seen ? " seen" : ""}" title="${seen ? "Seen" : "Sent"}"><i class="fa-solid fa-check-double"></i><small>${seen ? "Seen" : "Sent"}</small></span>` : ""}
      </div>
    </div>`;
  return wrap;
}
window.downloadAttachment = async function(url, name = "nexchat-file") {
  const cleanUrl = String(url || "");
  const cleanName = String(name || "nexchat-file").replace(/[\\/:*?"<>|]+/g, "_");
  if (!/^https:\/\//i.test(cleanUrl)) {
    showToast("Invalid download link.");
    return;
  }
  showToast("Starting download…");
  try {
    triggerLocalDownload(cleanUrl, cleanName);
  } catch (err) {
    console.warn("Direct download failed; opening file link instead:", err);
    const a = document.createElement("a");
    a.href = cleanUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast("File opened. Use browser save/download if needed.", 4500);
  }
};

function giphyConfigured() {
  return GIPHY_CONFIG?.apiKey && !String(GIPHY_CONFIG.apiKey).includes("YOUR_");
}

function renderGifResults(items = []) {
  const grid = $("gif-results");
  if (!grid) return;
  if (!items.length) {
    grid.innerHTML = '<div class="gif-empty">No GIFs found.</div>';
    return;
  }
  grid.innerHTML = "";
  items.forEach(gif => {
    const image = gif.images?.fixed_width?.url || gif.images?.downsized_medium?.url || gif.images?.original?.url || "";
    if (!image) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gif-card";
    btn.innerHTML = `<img src="${esc(image)}" alt="${esc(gif.title || "GIF")}" loading="lazy" decoding="async"/>`;
    btn.addEventListener("click", () => sendSelectedGif({
      id: gif.id || "",
      title: gif.title || "GIF",
      url: image
    }));
    grid.appendChild(btn);
  });
}

async function loadGifs(queryText = "") {
  const grid = $("gif-results");
  if (!grid) return;
  if (!giphyConfigured()) {
    grid.innerHTML = '<div class="gif-empty">Add your GIPHY API key in config/config.js first.</div>';
    return;
  }
  grid.innerHTML = '<div class="spinner"></div>';
  const params = new URLSearchParams({
    api_key: GIPHY_CONFIG.apiKey,
    limit: String(GIPHY_CONFIG.limit || 16),
    rating: GIPHY_CONFIG.rating || "g"
  });
  const endpoint = queryText.trim()
    ? `https://api.giphy.com/v1/gifs/search?${params}&q=${encodeURIComponent(queryText.trim())}`
    : `https://api.giphy.com/v1/gifs/trending?${params}`;
  try {
    const res = await fetch(endpoint);
    const data = await res.json();
    renderGifResults(Array.isArray(data.data) ? data.data : []);
  } catch (err) {
    console.error("GIPHY error:", err);
    grid.innerHTML = '<div class="gif-empty">Could not load GIFs. Check your API key or internet.</div>';
  }
}

window.openGifPicker = function() {
  if (contactBlocked) { showToast("You blocked this contact. GIF sharing is disabled."); return; }
  if (!currentChatId) { showToast("Open a chat before sending GIFs."); return; }
  $("gif-modal")?.classList.add("show");
  $("gif-search-input")?.focus();
  loadGifs($("gif-search-input")?.value || "");
};

window.closeGifPicker = function() {
  $("gif-modal")?.classList.remove("show");
};

window.searchGifs = function() {
  if (giphySearchTimer) clearTimeout(giphySearchTimer);
  const q = $("gif-search-input")?.value || "";
  giphySearchTimer = setTimeout(() => loadGifs(q), 350);
};

window.sendSelectedGif = async function(gif) {
  if (!currentChatId || !currentUser || !gif?.url) return;
  const btn = $("gif-btn");
  btn?.setAttribute("disabled", "true");
  try {
    await sendGifMsg(currentChatId, currentUser.uid, currentUser.displayName || "NexUser", gif);
    closeGifPicker();
    showToast("GIF sent ✅");
  } catch (err) {
    console.error("Send GIF error:", err);
    showToast("Could not send GIF. Deploy updated Firestore rules.");
  } finally {
    btn?.removeAttribute("disabled");
  }
};

window.sendMessage = async function() {
  const inp  = $("message-input");
  const text = inp.value.trim();
  if (contactBlocked) { showToast("You blocked this contact. Messages are disabled."); return; }
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
window.chooseFile = function() {
  if (contactBlocked) { showToast("You blocked this contact. File sharing is disabled."); return; }
  if (!currentChatId) {
    showToast("Open a chat before sending files.");
    return;
  }
  $("file-input")?.click();
};
window.handleFileSelect = async function(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file || !currentChatId) return;

  if (file.size > 10 * 1024 * 1024) {
    showToast("File is too large. Maximum size is 10 MB.");
    return;
  }

  const btn = $("attach-btn");
  btn?.classList.add("uploading");
  btn?.setAttribute("disabled", "true");
  showToast(file.type.startsWith("image/") ? "Uploading photo…" : "Uploading file…");

  try {
    await sendFileMsg(
      currentChatId,
      currentUser.uid,
      currentUser.displayName || "NexUser",
      file
    );
    showToast(file.type.startsWith("image/") ? "Photo sent ✅" : "File sent ✅");
  } catch (err) {
    console.error("File upload error:", err);
    showToast(err.message || friendlyErr(err.code));
  } finally {
    btn?.classList.remove("uploading");
    btn?.removeAttribute("disabled");
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

function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  const video = $("camera-video");
  if (video) video.srcObject = null;
}
window.openCameraCapture = async function() {
  if (contactBlocked) { showToast("You blocked this contact. Camera sending is disabled."); return; }
  if (!currentChatId) {
    showToast("Open a chat before sending a camera photo.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Camera is not available in this browser.");
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    const video = $("camera-video");
    if (video) video.srcObject = cameraStream;
    $("camera-modal")?.classList.add("show");
  } catch (err) {
    console.error("Camera open error:", err);
    showToast(err?.name === "NotAllowedError" ? "Camera permission denied." : "Could not open camera.");
  }
};
window.closeCameraCapture = function() {
  stopCameraStream();
  $("camera-modal")?.classList.remove("show");
};
window.captureCameraPhoto = async function() {
  const video = $("camera-video");
  if (!video || !cameraStream) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.toBlob(async blob => {
    if (!blob) {
      showToast("Could not capture photo.");
      return;
    }
    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
    window.closeCameraCapture();
    const btn = $("camera-send-btn");
    btn?.classList.add("uploading");
    try {
      showToast("Uploading camera photo…");
      await sendFileMsg(currentChatId, currentUser.uid, currentUser.displayName || "NexUser", file);
      showToast("Camera photo sent ✅");
    } catch (err) {
      console.error("Camera photo upload error:", err);
      showToast(err.message || friendlyErr(err.code));
    } finally {
      btn?.classList.remove("uploading");
    }
  }, "image/jpeg", 0.9);
};

function updateSignupPhotoPreview(fileOrUrl) {
  const box = $("signup-photo-preview");
  const txt = $("signup-photo-text");
  if (!box || !txt) return;
  if (!fileOrUrl) {
    box.innerHTML = '<i class="fa-solid fa-camera"></i>';
    box.classList.remove("has-photo");
    txt.textContent = "Add profile picture";
    return;
  }
  const url = typeof fileOrUrl === "string" ? fileOrUrl : URL.createObjectURL(fileOrUrl);
  box.innerHTML = `<img src="${esc(url)}" alt="Profile preview"/>`;
  box.classList.add("has-photo");
  txt.textContent = "Change profile picture";
}
function profilePhotoInput(target = "profile") {
  profileCropTarget = target;
  const input = target === "signup" ? $("signup-photo-input") : $("profile-photo-input");
  if (!input) return;
  input.value = "";
  input.click();
}
window.chooseProfilePhoto = () => profilePhotoInput("profile");
window.chooseSignupProfilePhoto = () => profilePhotoInput("signup");
window.handleProfilePhotoPick = e => openProfileCrop(e.target.files?.[0], "profile");
window.handleSignupProfilePhotoPick = e => openProfileCrop(e.target.files?.[0], "signup");
function openProfileCrop(file, target = "profile") {
  if (!file) return;
  if (!file.type?.startsWith("image/")) {
    showToast("Please choose an image file.");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showToast("Profile picture must be under 8 MB.");
    return;
  }
  profileCropTarget = target;
  const img = new Image();
  img.onload = () => {
    profileCropImage = img;
    profileCropScale = 1;
    profileCropOffset = { x: 0, y: 0 };
    const slider = $("profile-crop-zoom");
    if (slider) slider.value = "1";
    $("profile-crop-modal")?.classList.add("show");
    drawProfileCrop();
  };
  img.onerror = () => showToast("Could not read this image.");
  img.src = URL.createObjectURL(file);
}
function drawProfileCrop() {
  const canvas = $("profile-crop-canvas");
  const img = profileCropImage;
  if (!canvas || !img) return;
  const ctx = canvas.getContext("2d");
  const size = canvas.width = canvas.height = 320;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg-input") || "#111";
  ctx.fillRect(0, 0, size, size);
  const base = Math.max(size / img.width, size / img.height);
  const scale = base * profileCropScale;
  const w = img.width * scale;
  const h = img.height * scale;
  const x = (size - w) / 2 + profileCropOffset.x;
  const y = (size - h) / 2 + profileCropOffset.y;
  ctx.drawImage(img, x, y, w, h);
  ctx.strokeStyle = "rgba(255,215,0,.9)";
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, size - 4, size - 4);
}
window.updateProfileCropZoom = function(value) {
  profileCropScale = Number(value) || 1;
  drawProfileCrop();
};
function bindCropCanvasDrag() {
  const canvas = $("profile-crop-canvas");
  if (!canvas || canvas.dataset.bound === "1") return;
  canvas.dataset.bound = "1";
  const point = e => {
    const t = e.touches?.[0] || e;
    return { x: t.clientX, y: t.clientY };
  };
  const start = e => {
    e.preventDefault();
    const p = point(e);
    profileCropDrag = { x: p.x, y: p.y, ox: profileCropOffset.x, oy: profileCropOffset.y };
  };
  const move = e => {
    if (!profileCropDrag) return;
    e.preventDefault();
    const p = point(e);
    profileCropOffset.x = profileCropDrag.ox + (p.x - profileCropDrag.x);
    profileCropOffset.y = profileCropDrag.oy + (p.y - profileCropDrag.y);
    drawProfileCrop();
  };
  const end = () => { profileCropDrag = null; };
  canvas.addEventListener("mousedown", start);
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);
  canvas.addEventListener("touchstart", start, { passive: false });
  window.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("touchend", end);
}
window.closeProfileCrop = function() {
  $("profile-crop-modal")?.classList.remove("show");
  profileCropImage = null;
  profileCropDrag = null;
};
function canvasToBlob(canvas, type = "image/jpeg", quality = 0.88) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}
window.saveProfileCrop = async function() {
  const canvas = $("profile-crop-canvas");
  if (!canvas || !profileCropImage) return;
  const out = document.createElement("canvas");
  out.width = out.height = 512;
  out.getContext("2d").drawImage(canvas, 0, 0, 512, 512);
  const blob = await canvasToBlob(out);
  if (!blob) return showToast("Could not prepare profile picture.");
  const file = new File([blob], "profile-picture.jpg", { type: "image/jpeg" });
  if (profileCropTarget === "signup") {
    signupProfilePhotoFile = file;
    updateSignupPhotoPreview(file);
    closeProfileCrop();
    showToast("Profile picture ready for signup ✅");
    return;
  }
  if (!currentUser) return;
  const saveBtn = $("profile-crop-save-btn");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
  try {
    const updated = await updateUserProfilePhoto(currentUser.uid, file);
    const name = $("profile-disp-name")?.textContent || currentUser.displayName || currentUser.email || "NexUser";
    applyAvatar($("profile-av-big"), currentUser.uid, name, updated.photoURL);
    rememberContact({ ...(updated || {}), id: currentUser.uid, uid: currentUser.uid, email: currentUser.email });
    renderChatsList(allChats);
    closeProfileCrop();
    showToast("Profile picture updated ✅");
  } catch (err) {
    console.error("Profile photo update error:", err);
    showToast(err?.message || "Could not update profile picture.", 5000);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save profile photo"; }
  }
};
setTimeout(bindCropCanvasDrag, 0);

window.showUserProfile = async function(uid = currentContactId) {
  if (!uid) return;
  try {
    const user = await getUserData(uid);
    if (!user) {
      showToast("Profile not found.");
      return;
    }
    const fullUser = rememberContact({ ...user, id: uid, uid }) || { ...user, id: uid, uid };
    const name = displayUserName(fullUser);
    const modal = $("user-profile-modal");
    if (!modal) return;
    applyAvatar($("view-profile-av"), uid, name, userPhotoURL(fullUser), ";width:96px;height:96px;border-radius:28px;font-size:28px");
    $("view-profile-name").textContent = name;
    $("view-profile-email").textContent = fullUser.email || "";
    $("view-profile-id").textContent = publicUserId({ ...fullUser, uid });
    const live = userIsOnline(fullUser);
    $("view-profile-status").textContent = live ? "online" : "last seen " + fmtLastSeen(fullUser.lastSeen || fullUser.lastActive);
    $("view-profile-status").className = "profile-view-status" + (live ? " online" : "");
    $("view-profile-msg-btn").onclick = () => {
      closeUserProfile();
      startChat(uid, name);
    };
    modal.classList.add("show");
  } catch (err) {
    console.error("View profile error:", err);
    showToast("Could not load profile.");
  }
};
window.viewCurrentProfile = function() {
  if (currentContactId) showUserProfile(currentContactId);
};
window.closeUserProfile = function() {
  $("user-profile-modal")?.classList.remove("show");
};

window.openUsernameEdit = function() {
  const form = $("profile-name-edit-form");
  const input = $("profile-name-input");
  if (!form || !input) return;
  input.value = ($("profile-disp-name")?.textContent || currentUser?.displayName || "").trim();
  form.classList.add("show");
  setTimeout(() => input.focus(), 50);
};

window.cancelUsernameEdit = function() {
  const form = $("profile-name-edit-form");
  if (form) form.classList.remove("show");
};

window.handleUsernameUpdate = async function(e) {
  e.preventDefault();
  if (!currentUser) return;
  const input = $("profile-name-input");
  const newName = String(input?.value || "").trim();
  if (newName.length < 2) { showToast("Username must be at least 2 characters."); return; }
  if (newName.length > 40) { showToast("Username can be maximum 40 characters."); return; }
  const btn = $("profile-name-save-btn");
  btn?.classList.add("loading");
  try {
    await updateUserDisplayName(currentUser.uid, newName);
    currentUser.displayName = newName;
    $("profile-disp-name").textContent = newName;
    rememberContact({ id: currentUser.uid, uid: currentUser.uid, name: newName, email: currentUser.email });
    const fresh = await getUserData(currentUser.uid).catch(() => null);
    applyAvatar($("profile-av-big"), currentUser.uid, newName, userPhotoURL(fresh || currentUser));
    cancelUsernameEdit();
    showToast("Username updated ✅");
  } catch (err) {
    console.error("Username update error:", err);
    showToast(err.message || friendlyErr(err.code));
  } finally {
    btn?.classList.remove("loading");
  }
};

window.toggleProfile = function() {
  $("profile-panel").classList.toggle("open");
};
window.toggleNewConv = function() {
  const panel = $("new-conv-panel");
  panel.classList.toggle("open");
  if (panel.classList.contains("open")) {
    $("user-search-inp").value = "";
    renderUserSearchHint();
  }
};

window.closeMobileChat = function() {
  closeFloatingPanels();
  $("chat-search-panel")?.classList.remove("show");
  $("chat-area").classList.remove("mobile-active");
};

function showIncomingCall(call) {
  incomingCallData = call;
  const modal = $("incoming-call");
  if (!modal) return;
  $("incoming-call-name").textContent = call.callerName || "NexChat User";
  const label = call.type === "video" ? "Incoming video call" : "Incoming audio call";
  $("incoming-call-type").textContent = label;
  modal.classList.add("show");
  showToast(`${label} from ${call.callerName || "NexChat User"}`, 7000);
  startRingTone();
}
function hideIncomingCall() {
  const modal = $("incoming-call");
  if (modal) modal.classList.remove("show");
  stopRingTone();
  incomingCallData = null;
}
function handleIncomingCall(call) {
  if (!currentUser || !call || call.calleeId !== currentUser.uid) return;
  if (activeCallId && activeCallId !== call.id) {
    updateCallStatus(call.id, "rejected");
    return;
  }
  showIncomingCall(call);
}
function setCallStatus(text) {
  const el = $("call-status");
  if (el) el.textContent = text;
}
function attachStreamToVideo(videoId, stream, muted = false) {
  const video = $(videoId);
  if (!video || !stream) return;
  video.srcObject = stream;
  video.muted = !!muted;
  video.playsInline = true;
  const play = () => video.play?.().catch(() => {});
  if (video.readyState >= 2) play();
  video.onloadedmetadata = play;
}
function setRemoteVideoReady(isReady) {
  $("call-modal")?.classList.toggle("has-remote-video", !!isReady);
}
function showCallModal(type, name, statusText) {
  const modal = $("call-modal");
  if (!modal) return;
  activeCallType = type;
  modal.classList.add("show");
  modal.classList.toggle("video-mode", type === "video");
  modal.classList.toggle("audio-mode", type !== "video");
  $("call-contact-name").textContent = name || "NexChat User";
  setCallStatus(statusText || "Connecting…");
  setRemoteVideoReady(false);
  $("camera-btn")?.classList.toggle("hidden", type !== "video");
}
async function getCallMedia(type) {
  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: type === "video" ? { facingMode: "user" } : false
  });
}
function resetCallButtons() {
  isMuted = false;
  isCameraOff = false;
  const muteBtn = $("mute-btn");
  const cameraBtn = $("camera-btn");
  if (muteBtn) {
    muteBtn.classList.remove("off");
    muteBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
  }
  if (cameraBtn) {
    cameraBtn.classList.remove("off");
    cameraBtn.innerHTML = '<i class="fa-solid fa-video"></i>';
  }
}
function createPeerConnection(role) {
  currentCallRole = role;
  pendingIce = [];
  remoteStream = new MediaStream();
  attachStreamToVideo("remote-video", remoteStream, false);
  setRemoteVideoReady(false);

  peerConnection = new RTCPeerConnection(RTC_CONFIG);
  peerConnection.ontrack = event => {
    const firstStream = event.streams && event.streams[0];
    if (firstStream) {
      remoteStream = firstStream;
      attachStreamToVideo("remote-video", firstStream, false);
    } else if (event.track) {
      remoteStream.addTrack(event.track);
      attachStreamToVideo("remote-video", remoteStream, false);
    }
    setRemoteVideoReady(true);
    setCallStatus("Connected");
  };
  peerConnection.onicecandidate = event => {
    if (!event.candidate) return;
    const candidate = event.candidate.toJSON();
    if (activeCallId) {
      addIceCandidateToCall(activeCallId, role, candidate).catch(console.error);
    } else {
      pendingIce.push(candidate);
    }
  };
  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection?.connectionState;
    if (state === "connected") setCallStatus("Connected");
    if (["failed", "disconnected", "closed"].includes(state)) setCallStatus("Call ended");
  };
}
async function flushPendingIce() {
  const toSend = pendingIce.splice(0);
  await Promise.all(toSend.map(c => addIceCandidateToCall(activeCallId, currentCallRole, c).catch(console.error)));
}
function addCallUnsub(unsub) {
  if (typeof unsub === "function") callUnsubs.push(unsub);
}
function cleanupCall(updateRemote = false) {
  if (updateRemote && activeCallId) updateCallStatus(activeCallId, "ended").catch(console.error);
  callUnsubs.forEach(unsub => { try { unsub(); } catch {} });
  callUnsubs = [];
  if (peerConnection) {
    try { peerConnection.close(); } catch {}
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
    remoteStream = null;
  }
  const localVideo = $("local-video");
  const remoteVideo = $("remote-video");
  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;
  $("call-modal")?.classList.remove("show", "has-remote-video");
  activeCallId = null;
  activeCallType = null;
  currentCallRole = null;
  pendingIce = [];
  resetCallButtons();
}
function listenForCallEnd(callId) {
  addCallUnsub(listenCallDoc(callId, async call => {
    if (!call) return;
    if (["ended", "rejected", "missed"].includes(call.status)) {
      const msg = call.status === "rejected" ? "Call rejected" : "Call ended";
      showToast(msg);
      cleanupCall(false);
      hideIncomingCall();
    }
  }));
}
function listenForRemoteAnswer(callId) {
  addCallUnsub(listenCallDoc(callId, async call => {
    if (!call) return;
    if (call.status === "rejected") {
      showToast("Call rejected");
      cleanupCall(false);
      return;
    }
    if (call.answer && peerConnection && !peerConnection.currentRemoteDescription) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(call.answer));
      setCallStatus("Connected");
    }
    if (call.status === "ended") cleanupCall(false);
  }));
}
function listenForRemoteIce(callId, role) {
  addCallUnsub(listenIceCandidates(callId, role, async candidate => {
    try {
      if (peerConnection && candidate) await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn("Could not add ICE candidate:", err);
    }
  }));
}
window.startCall = async function(type = "audio") {
  if (contactBlocked) { showToast("You blocked this contact. Calls are disabled."); return; }
  if (!currentChatId || !currentContactId) {
    showToast("Open a chat before starting a call.");
    return;
  }
  if (activeCallId) {
    showToast("You are already in a call.");
    return;
  }
  try {
    const contact = await getUserData(currentContactId) || {};
    const contactName = displayUserName(contact, $("chat-h-name")?.textContent || "NexChat User");
    showCallModal(type, contactName, type === "video" ? "Starting video call…" : "Starting audio call…");
    localStream = await getCallMedia(type);
    attachStreamToVideo("local-video", localStream, true);
    createPeerConnection("caller");
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    activeCallId = await createCall({
      chatId: currentChatId,
      callerId: currentUser.uid,
      callerName: currentUser.displayName || "NexUser",
      calleeId: currentContactId,
      calleeName: contactName,
      type,
      offer: { type: offer.type, sdp: offer.sdp }
    });
    await flushPendingIce();
    setCallStatus("Ringing…");
    listenForRemoteAnswer(activeCallId);
    listenForRemoteIce(activeCallId, "caller");
  } catch (err) {
    console.error("Start call error:", err);
    cleanupCall(false);
    showToast(err?.name === "NotAllowedError" ? "Microphone/camera permission denied." : "Could not start call.");
  }
};
window.acceptIncomingCall = async function() {
  const call = incomingCallData;
  if (!call || activeCallId) return;
  hideIncomingCall();
  try {
    activeCallId = call.id;
    showCallModal(call.type, call.callerName, "Connecting…");
    localStream = await getCallMedia(call.type);
    attachStreamToVideo("local-video", localStream, true);
    createPeerConnection("callee");
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    await peerConnection.setRemoteDescription(new RTCSessionDescription(call.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await answerCall(activeCallId, { type: answer.type, sdp: answer.sdp });
    await flushPendingIce();
    listenForCallEnd(activeCallId);
    listenForRemoteIce(activeCallId, "callee");
  } catch (err) {
    console.error("Accept call error:", err);
    updateCallStatus(activeCallId, "ended").catch(console.error);
    cleanupCall(false);
    showToast(err?.name === "NotAllowedError" ? "Microphone/camera permission denied." : "Could not answer call.");
  }
};
window.declineIncomingCall = async function() {
  if (incomingCallData?.id) await updateCallStatus(incomingCallData.id, "rejected");
  hideIncomingCall();
};
window.endCurrentCall = function() {
  cleanupCall(true);
};

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeCallId) {
    cleanupCall(true);
  }
});
window.toggleMute = function() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(track => { track.enabled = !isMuted; });
  const btn = $("mute-btn");
  btn?.classList.toggle("off", isMuted);
  if (btn) btn.innerHTML = isMuted ? '<i class="fa-solid fa-microphone-slash"></i>' : '<i class="fa-solid fa-microphone"></i>';
};
window.toggleCamera = function() {
  if (!localStream) return;
  isCameraOff = !isCameraOff;
  localStream.getVideoTracks().forEach(track => { track.enabled = !isCameraOff; });
  const btn = $("camera-btn");
  btn?.classList.toggle("off", isCameraOff);
  if (btn) btn.innerHTML = isCameraOff ? '<i class="fa-solid fa-video-slash"></i>' : '<i class="fa-solid fa-video"></i>';
};