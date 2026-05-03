import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  where,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, COLLECTIONS, CLOUDINARY_CONFIG } from "./config/config.js";
import {
  onAuthReady,
  onChatsUpdate,
  onMessagesUpdate
} from "./app.js";

const fbApp   = initializeApp(firebaseConfig);
const auth    = getAuth(fbApp);
const db      = getFirestore(fbApp);

let unsubMessages    = null;
let unsubChats       = null;
let unsubStatus      = null;
let unsubUsers       = null;
let unsubIncomingCalls = null;
let presenceTimer    = null;
let visibilityBound  = false;
let activePresenceId = null;

onAuthStateChanged(auth, async user => {
  try {
    if (user) {
      await ensureUserDoc(user);
      startPresence(user.uid);
      onAuthReady(user, true);
      startChatsListener(user.uid);
    } else {
      stopAllListeners();
      onAuthReady(null, false);
    }
  } catch (err) {
    console.error("Auth state error:", err);
    onAuthReady(user || null, !!user);
    if (typeof window.showToast === "function") {
      window.showToast("Firebase connection error. Check config and Firebase rules.");
    }
  }
});

function makeNexId(uid = "") {
  return `NEX-${String(uid).slice(0, 10).toUpperCase()}`;
}
function cleanPublicId(value = "") {
  return String(value || "").trim().toLowerCase();
}
function normalizeSearchValue(value = "") {
  return String(value || "").trim().toLowerCase();
}
function makeSearchTokens(data = {}) {
  const values = [
    data.name,
    data.email,
    data.nexId,
    data.uid,
    String(data.email || "").split("@")[0],
    String(data.email || "").split("@")[1],
    ...String(data.name || "").split(/\s+/)
  ];
  const tokens = new Set();
  const addPrefixes = (value) => {
    const clean = normalizeSearchValue(value);
    if (!clean) return;
    const compact = clean.replace(/\s+/g, " ");
    for (let i = 2; i <= Math.min(compact.length, 60); i++) tokens.add(compact.slice(0, i));
    compact.split(/[^a-z0-9@._-]+/i).forEach(part => {
      if (part.length >= 2) {
        for (let i = 2; i <= Math.min(part.length, 40); i++) tokens.add(part.slice(0, i));
      }
    });
    for (let i = 0; i < compact.length; i++) {
      for (let len = 3; len <= Math.min(12, compact.length - i); len++) {
        const chunk = compact.slice(i, i + len);
        if (/^[a-z0-9@._-]+$/i.test(chunk)) tokens.add(chunk);
      }
    }
  };
  values.forEach(addPrefixes);
  return Array.from(tokens).slice(0, 450);
}
function publicProfileFields(user, extra = {}) {
  const nexId = extra.nexId || makeNexId(user.uid);
  const name = extra.name || user.displayName || "NexUser";
  const email = extra.email || user.email || "";
  return {
    uid: user.uid,
    name,
    email,
    nameLower: normalizeSearchValue(name),
    emailLower: normalizeSearchValue(email),
    nexId,
    nexIdLower: cleanPublicId(nexId),
    photoURL: extra.photoURL || user.photoURL || "",
    photoPublicId: extra.photoPublicId || ""
  };
}
async function upsertUserLookup(user, data = {}) {
  const profile = publicProfileFields(user, data);
  await setDoc(doc(db, "userLookup", cleanPublicId(profile.nexId)), {
    uid: profile.uid,
    nexId: profile.nexId,
    name: profile.name,
    email: profile.email,
    photoURL: profile.photoURL || "",
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function ensureUserDoc(user) {
  const ref  = doc(db, COLLECTIONS.USERS, user.uid);
  const snap = await getDoc(ref);
  const profile = publicProfileFields(user);
  const baseData = {
    ...profile,
    searchTokens: makeSearchTokens(profile),
    online:     true,
    lastSeen:   serverTimestamp(),
    lastActive: serverTimestamp()
  };
  if (!snap.exists()) {
    await setDoc(ref, { ...baseData, createdAt: serverTimestamp() });
  } else {
    const old = snap.data() || {};
    await updateDoc(ref, {
      name: profile.name,
      nameLower: profile.nameLower,
      emailLower: profile.emailLower,
      nexId: profile.nexId,
      nexIdLower: profile.nexIdLower,
      photoURL: old.photoURL || profile.photoURL || "",
      photoPublicId: old.photoPublicId || profile.photoPublicId || "",
      searchTokens: makeSearchTokens({ ...profile, photoURL: old.photoURL || profile.photoURL || "" }),
      online:     true,
      lastSeen:   serverTimestamp(),
      lastActive: serverTimestamp()
    });
  }
  await upsertUserLookup(user, { ...baseData, photoURL: snap.exists() ? (snap.data().photoURL || profile.photoURL || "") : profile.photoURL });
}

export async function signUp(name, email, password, profileFile = null) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);

  let photoURL = "";
  let photoPublicId = "";
  if (profileFile) {
    const fileType = profileFile.type || "";
    if (!fileType.startsWith("image/")) throw new Error("Profile picture must be an image.");
    if (profileFile.size > 5 * 1024 * 1024) throw new Error("Profile picture is too large. Maximum size is 5 MB.");
    const cleanName = safeFileName(profileFile.name || `profile-${cred.user.uid}.jpg`);
    const uploaded = await uploadToCloudinary(profileFile, `profiles/${cred.user.uid}`, cleanName, "nexchat,profile-photo");
    photoURL = uploaded.url;
    photoPublicId = uploaded.publicId;
  }

  await updateProfile(cred.user, { displayName: name, ...(photoURL ? { photoURL } : {}) });
  const profile = publicProfileFields(cred.user, { name, email, photoURL, photoPublicId });
  const userData = {
    ...profile,
    searchTokens: makeSearchTokens(profile),
    online:     true,
    lastSeen:   serverTimestamp(),
    lastActive: serverTimestamp(),
    createdAt:  serverTimestamp()
  };
  await setDoc(doc(db, COLLECTIONS.USERS, cred.user.uid), userData);
  await upsertUserLookup(cred.user, userData);
  return cred.user;
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function updateUserProfilePhoto(uid, file) {
  if (!uid || !file) throw new Error("No profile photo selected.");
  if (!auth.currentUser || auth.currentUser.uid !== uid) throw new Error("You can only update your own profile photo.");
  const fileType = file.type || "";
  if (!fileType.startsWith("image/")) throw new Error("Profile picture must be an image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Profile picture is too large. Maximum size is 5 MB.");
  const cleanName = safeFileName(file.name || `profile-${uid}.jpg`);
  const uploaded = await uploadToCloudinary(file, `profiles/${uid}`, cleanName, "nexchat,profile-photo");
  await updateProfile(auth.currentUser, { photoURL: uploaded.url });
  const userSnap = await getDoc(doc(db, COLLECTIONS.USERS, uid));
  const old = userSnap.exists() ? userSnap.data() : {};
  const profile = publicProfileFields(auth.currentUser, {
    name: old.name || auth.currentUser.displayName || "NexUser",
    email: old.email || auth.currentUser.email || "",
    photoURL: uploaded.url,
    photoPublicId: uploaded.publicId
  });
  await setDoc(doc(db, COLLECTIONS.USERS, uid), {
    ...old,
    ...profile,
    searchTokens: makeSearchTokens(profile),
    photoURL: uploaded.url,
    photoPublicId: uploaded.publicId,
    updatedAt: serverTimestamp()
  }, { merge: true });
  await upsertUserLookup(auth.currentUser, profile);
  return uploaded.url;
}

export async function logOut(uid) {
  await markOffline(uid);
  await signOut(auth);
}

async function markOnline(uid) {
  if (!uid) return;
  try {
    await updateDoc(doc(db, COLLECTIONS.USERS, uid), {
      online:     true,
      lastSeen:   serverTimestamp(),
      lastActive: serverTimestamp()
    });
  } catch (err) {
    console.warn("Could not update online status:", err);
  }
}

async function markOffline(uid) {
  const targetUid = uid || activePresenceId;
  if (!targetUid) return;
  try {
    await updateDoc(doc(db, COLLECTIONS.USERS, targetUid), {
      online:     false,
      lastSeen:   serverTimestamp(),
      lastActive: serverTimestamp()
    });
  } catch (err) {
    console.warn("Could not update offline status:", err);
  }
}

function startPresence(uid) {
  activePresenceId = uid;
  if (presenceTimer) clearInterval(presenceTimer);
  markOnline(uid);
  presenceTimer = setInterval(() => markOnline(uid), 25000);

  if (!visibilityBound) {
    visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (!activePresenceId) return;
      if (document.visibilityState === "visible") {
        markOnline(activePresenceId);
      } else {
        markOffline(activePresenceId);
      }
    });
    window.addEventListener("beforeunload", () => {
      markOffline(activePresenceId);
    });
  }
}

function normalizeUsersFromSnap(snap, currentUid) {
  const currentEmail = String(auth.currentUser?.email || "").toLowerCase();
  const seen = new Set();
  const users = [];

  snap.forEach(d => {
    const data = d.data();
    const email = String(data.email || "").toLowerCase();
    const uid = data.uid || d.id;
    const isMe = d.id === currentUid || uid === currentUid || (currentEmail && email === currentEmail);
    if (!isMe && !seen.has(uid)) {
      seen.add(uid);
      users.push({ id: uid, docId: d.id, ...data, uid });
    }
  });

  users.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  return users;
}

function publishUsers(users) {
  if (typeof window.__onUsersLoaded === "function") {
    window.__onUsersLoaded(users);
  }
}

function startUsersListener(currentUid) {
  if (unsubUsers) unsubUsers();
  unsubUsers = onSnapshot(
    collection(db, COLLECTIONS.USERS),
    snap => publishUsers(normalizeUsersFromSnap(snap, currentUid)),
    err => {
      console.error("Users listener error:", err);
      if (typeof window.showToast === "function") {
        window.showToast("Could not load users. Check Firestore rules.");
      }
    }
  );
}

export async function loadAllUsersData(currentUid) {
  if (!currentUid) return;
  try {
    const snap = await getDocs(collection(db, COLLECTIONS.USERS));
    publishUsers(normalizeUsersFromSnap(snap, currentUid));
  } catch (err) {
    console.error("Load users error:", err);
    if (typeof window.showToast === "function") {
      window.showToast("Could not load users. Check Firestore rules.");
    }
  }
}

export async function findUserByPublicId(searchValue, currentUid) {
  const raw = String(searchValue || "").trim();
  if (!raw) return null;

  let uid = "";
  const lookupId = cleanPublicId(raw);

  if (raw.startsWith("NEX-") || raw.startsWith("nex-")) {
    const lookupSnap = await getDoc(doc(db, "userLookup", lookupId));
    if (lookupSnap.exists()) uid = lookupSnap.data().uid || "";
  }
  if (!uid) uid = raw.replace(/^id:/i, "").trim();
  if (!uid || uid === currentUid) return null;

  const snap = await getDoc(doc(db, COLLECTIONS.USERS, uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.uid === currentUid || snap.id === currentUid) return null;
  return { id: data.uid || snap.id, docId: snap.id, ...data, uid: data.uid || snap.id };
}

export async function searchUsersByQuery(searchValue, currentUid) {
  const qText = normalizeSearchValue(searchValue);
  if (!qText || qText.length < 2) return [];

  const byId = new Map();
  const addUsers = users => {
    users.forEach(u => {
      const id = u.uid || u.id;
      if (id && id !== currentUid) byId.set(id, { ...u, id, uid: id });
    });
  };

  try {
    const tokenSnap = await getDocs(
      query(collection(db, COLLECTIONS.USERS), where("searchTokens", "array-contains", qText), limit(20))
    );
    addUsers(normalizeUsersFromSnap(tokenSnap, currentUid));
  } catch (err) {
    console.warn("Token user search fallback:", err);
  }
  try {
    const snap = await getDocs(collection(db, COLLECTIONS.USERS));
    const users = normalizeUsersFromSnap(snap, currentUid).filter(user => {
      const fields = [
        user.name,
        user.displayName,
        user.email,
        String(user.email || "").split("@")[0],
        user.uid,
        user.id,
        user.nexId,
        makeNexId(user.uid || user.id || "")
      ].map(v => normalizeSearchValue(v));
      return fields.some(v => v && (v.includes(qText) || qText.includes(v)));
    });
    addUsers(users);
  } catch (err) {
    console.error("Fallback user search error:", err);
  }

  return Array.from(byId.values())
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .slice(0, 20);
}

export async function getUserData(uid) {
  const snap = await getDoc(doc(db, COLLECTIONS.USERS, uid));
  return snap.exists() ? snap.data() : null;
}

export function startChatsListener(uid) {
  if (unsubChats) unsubChats();
  const q = query(
    collection(db, COLLECTIONS.CHATS),
    where("members", "array-contains", uid),
    orderBy("lastMessageTime", "desc")
  );
  unsubChats = onSnapshot(
    q,
    snap => {
      const chats = [];
      snap.forEach(d => chats.push({ id: d.id, ...d.data() }));
      onChatsUpdate(chats);
    },
    err => {
      console.error("Chats listener error:", err);
      if (typeof window.showToast === "function") {
        window.showToast("Could not load chats. Deploy Firestore index/rules.");
      }
    }
  );
}

export async function getOrCreateChat(myUid, myName, contactUid, contactName) {
  if (!myUid || !contactUid) throw new Error("Missing user id for chat.");
  if (myUid === contactUid) throw new Error("Cannot create a chat with yourself.");

  const chatId  = [myUid, contactUid].sort().join("_");
  const chatRef = doc(db, COLLECTIONS.CHATS, chatId);

  try {
    const snap = await getDoc(chatRef);
    if (snap.exists()) return chatId;
  } catch (err) {
    if (err?.code !== "permission-denied") throw err;
    console.warn("Chat lookup denied; trying chat creation:", err);
  }

  await setDoc(chatRef, {
    members:         [myUid, contactUid],
    memberNames:     { [myUid]: myName, [contactUid]: contactName },
    lastMessage:     "",
    lastMessageTime: serverTimestamp(),
    lastSenderId:    "",
    lastSenderName:  "",
    createdAt:       serverTimestamp()
  });

  return chatId;
}

export function startMessagesListener(chatId) {
  if (unsubMessages) unsubMessages();
  const q = query(
    collection(db, COLLECTIONS.CHATS, chatId, COLLECTIONS.MESSAGES),
    orderBy("timestamp", "asc")
  );
  unsubMessages = onSnapshot(
    q,
    snap => {
      const msgs = [];
      snap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
      onMessagesUpdate(msgs);
    },
    err => {
      console.error("Messages listener error:", err);
      if (typeof window.showToast === "function") {
        window.showToast("Could not load messages. Check Firestore rules.");
      }
    }
  );
}

function shortLastMessage(text) {
  return text.length > 45 ? text.slice(0, 45) + "…" : text;
}

export async function sendMsg(chatId, senderId, senderName, text) {
  const cleanText = String(text || "").trim();
  await addDoc(
    collection(db, COLLECTIONS.CHATS, chatId, COLLECTIONS.MESSAGES),
    {
      type:       "text",
      text:       cleanText,
      senderId,
      senderName,
      timestamp:  serverTimestamp()
    }
  );
  await updateDoc(doc(db, COLLECTIONS.CHATS, chatId), {
    lastMessage:     shortLastMessage(cleanText),
    lastMessageTime: serverTimestamp(),
    lastSenderId:    senderId,
    lastSenderName:  senderName
  });
}

function safeFileName(name = "file") {
  return String(name)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120) || "file";
}

function cloudinaryIsConfigured() {
  return CLOUDINARY_CONFIG
    && CLOUDINARY_CONFIG.cloudName
    && CLOUDINARY_CONFIG.uploadPreset
    && !String(CLOUDINARY_CONFIG.cloudName).includes("YOUR_")
    && !String(CLOUDINARY_CONFIG.uploadPreset).includes("YOUR_");
}

async function uploadToCloudinary(file, folderPath, cleanName, tags = "nexchat") {
  if (!cloudinaryIsConfigured()) {
    throw new Error("Cloudinary is not configured. Add your cloudName and unsigned uploadPreset in config/config.js.");
  }

  const folderRoot = CLOUDINARY_CONFIG.folder || "nexchat_uploads";
  const folder = `${folderRoot}/${folderPath}`.replace(/\/+/g, "/");
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_CONFIG.uploadPreset);
  formData.append("folder", folder);
  formData.append("public_id", `${Date.now()}-${cleanName.replace(/\.[^/.]+$/, "")}`);
  formData.append("tags", tags);

  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/auto/upload`;
  const res = await fetch(endpoint, { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const detail = data?.error?.message || `Cloudinary upload failed (${res.status}).`;
    throw new Error(detail);
  }

  return {
    url: data.secure_url,
    publicId: data.public_id || "cloudinary-upload",
    resourceType: data.resource_type || "auto"
  };
}

export async function sendFileMsg(chatId, senderId, senderName, file) {
  if (!file) throw new Error("No file selected.");
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) throw new Error("File is too large. Maximum size is 10 MB.");

  const fileType = file.type || "application/octet-stream";
  const msgType  = fileType.startsWith("image/") ? "image" : "file";
  const cleanName = safeFileName(file.name || (msgType === "image" ? "photo.jpg" : "file"));
  const uploaded = await uploadToCloudinary(file, `${senderId}/${chatId}`, cleanName, "nexchat,chat-upload");

  await addDoc(
    collection(db, COLLECTIONS.CHATS, chatId, COLLECTIONS.MESSAGES),
    {
      type:        msgType,
      text:        "",
      senderId,
      senderName,
      timestamp:   serverTimestamp(),
      fileName:    cleanName,
      fileUrl:     uploaded.url,
      fileType,
      fileSize:    file.size,
      storagePath: uploaded.publicId
    }
  );

  await updateDoc(doc(db, COLLECTIONS.CHATS, chatId), {
    lastMessage:     msgType === "image" ? "📷 Photo" : `📎 ${shortLastMessage(cleanName)}`,
    lastMessageTime: serverTimestamp(),
    lastSenderId:    senderId,
    lastSenderName:  senderName
  });
}

export function stopMessagesListener() {
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
}

export async function deleteMessages(chatId, messageIds = []) {
  if (!chatId || !Array.isArray(messageIds) || !messageIds.length) return;
  const uniqueIds = [...new Set(messageIds)].filter(Boolean);
  await Promise.all(uniqueIds.map(id => deleteDoc(doc(db, COLLECTIONS.CHATS, chatId, COLLECTIONS.MESSAGES, id))));
  await updateDoc(doc(db, COLLECTIONS.CHATS, chatId), {
    lastMessage: "Message deleted",
    lastMessageTime: serverTimestamp()
  });
}

export async function deleteWholeChat(chatId) {
  if (!chatId) return;
  const msgSnap = await getDocs(collection(db, COLLECTIONS.CHATS, chatId, COLLECTIONS.MESSAGES));
  await Promise.all(msgSnap.docs.map(d => deleteDoc(d.ref)));
  await deleteDoc(doc(db, COLLECTIONS.CHATS, chatId));
}

function blockDocId(blockerId, blockedId) {
  return `${blockerId}_${blockedId}`;
}

export async function blockContact(blockerId, blockedId) {
  if (!blockerId || !blockedId || blockerId === blockedId) throw new Error("Invalid contact to block.");
  await setDoc(doc(db, "blocks", blockDocId(blockerId, blockedId)), {
    blockerId,
    blockedId,
    createdAt: serverTimestamp()
  }, { merge: true });
}

export async function isContactBlocked(myUid, contactUid) {
  if (!myUid || !contactUid) return { iBlocked: false, theyBlocked: false, blocked: false };
  const [mine, theirs] = await Promise.all([
    getDoc(doc(db, "blocks", blockDocId(myUid, contactUid))),
    getDoc(doc(db, "blocks", blockDocId(contactUid, myUid)))
  ]);
  return { iBlocked: mine.exists(), theyBlocked: theirs.exists(), blocked: mine.exists() || theirs.exists() };
}

export function startIncomingCallsListener(uid, callback) {
  if (!uid) return;
  if (unsubIncomingCalls) unsubIncomingCalls();
  const q = query(collection(db, COLLECTIONS.CALLS), where("calleeId", "==", uid));
  unsubIncomingCalls = onSnapshot(
    q,
    snap => {
      snap.docChanges().forEach(change => {
        const data = change.doc.data();
        if (["added", "modified"].includes(change.type) && data.status === "ringing") {
          callback({ id: change.doc.id, ...data });
        }
      });
    },
    err => console.error("Incoming calls listener error:", err)
  );
}

export function stopIncomingCallsListener() {
  if (unsubIncomingCalls) { unsubIncomingCalls(); unsubIncomingCalls = null; }
}

export async function createCall({ chatId, callerId, callerName, calleeId, calleeName, type, offer }) {
  const ref = await addDoc(collection(db, COLLECTIONS.CALLS), {
    chatId,
    callerId,
    callerName,
    calleeId,
    calleeName,
    type,
    offer,
    answer: null,
    status: "ringing",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function answerCall(callId, answer) {
  await updateDoc(doc(db, COLLECTIONS.CALLS, callId), {
    answer,
    status: "active",
    updatedAt: serverTimestamp()
  });
}

export async function updateCallStatus(callId, status) {
  if (!callId) return;
  await updateDoc(doc(db, COLLECTIONS.CALLS, callId), {
    status,
    updatedAt: serverTimestamp()
  });
}

export function listenCallDoc(callId, callback) {
  return onSnapshot(
    doc(db, COLLECTIONS.CALLS, callId),
    snap => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    err => console.error("Call listener error:", err)
  );
}

export async function addIceCandidateToCall(callId, role, candidate) {
  const sub = role === "caller" ? "callerCandidates" : "calleeCandidates";
  await addDoc(collection(db, COLLECTIONS.CALLS, callId, sub), candidate);
}

export function listenIceCandidates(callId, role, callback) {
  const sub = role === "caller" ? "calleeCandidates" : "callerCandidates";
  return onSnapshot(
    collection(db, COLLECTIONS.CALLS, callId, sub),
    snap => {
      snap.docChanges().forEach(change => {
        if (change.type === "added") callback(change.doc.data());
      });
    },
    err => console.error("ICE listener error:", err)
  );
}

export function watchContactStatus(contactUid, callback) {
  if (unsubStatus) unsubStatus();
  unsubStatus = onSnapshot(
    doc(db, COLLECTIONS.USERS, contactUid),
    snap => { if (snap.exists()) callback(snap.data()); },
    err => console.error("Status listener error:", err)
  );
}

function stopAllListeners() {
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  if (unsubChats)    { unsubChats();    unsubChats    = null; }
  if (unsubStatus)   { unsubStatus();   unsubStatus   = null; }
  if (unsubUsers)    { unsubUsers();    unsubUsers    = null; }
  if (unsubIncomingCalls) { unsubIncomingCalls(); unsubIncomingCalls = null; }
  if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
  activePresenceId = null;
}

export function friendlyErr(code) {
  return ({
    "auth/user-not-found":         "No account found with this email.",
    "auth/wrong-password":         "Wrong password. Please try again.",
    "auth/invalid-credential":     "Invalid email or password.",
    "auth/email-already-in-use":   "This email is already registered.",
    "auth/weak-password":          "Password must be at least 6 characters.",
    "auth/invalid-email":          "Please enter a valid email address.",
    "auth/too-many-requests":      "Too many attempts. Please try again later.",
    "auth/network-request-failed": "Network error. Check your connection.",
    "storage/unauthorized":        "Upload permission denied.",
    "storage/canceled":            "Upload canceled.",
    "storage/unknown":             "Upload failed. Check upload settings.",
    "permission-denied":           "Permission denied. Deploy Firebase rules."
  }[code] || "Something went wrong. Please try again.");
}
