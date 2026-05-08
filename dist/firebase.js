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
  limit,
  arrayUnion,
  writeBatch
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
const userDocCache = new Map();
const USER_DOC_CACHE_MS = 60000;

async function getCachedUserDoc(uid, force = false) {
  if (!uid) return null;
  const cached = userDocCache.get(uid);
  if (!force && cached && Date.now() - cached.time < USER_DOC_CACHE_MS) return cached.data;
  const snap = await getDoc(doc(db, COLLECTIONS.USERS, uid));
  const data = snap.exists() ? snap.data() : null;
  if (data) userDocCache.set(uid, { data, time: Date.now() });
  return data;
}
function rememberUserDoc(uid, data = {}) {
  if (!uid || !data) return;
  userDocCache.set(uid, { data: { ...(userDocCache.get(uid)?.data || {}), ...data }, time: Date.now() });
}

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
function isRealName(value = "") {
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
function bestStoredName(data = {}) {
  if (isRealName(data.name)) return String(data.name).trim();
  if (isRealName(data.displayName)) return String(data.displayName).trim();
  return fallbackNameFromEmail(data.email) || "NexUser";
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
    // Add useful chunks so searching a middle part of email/ID also works in the app.
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
  const email = extra.email || user.email || "";
  const name = isRealName(extra.name) ? String(extra.name).trim() : (isRealName(user.displayName) ? String(user.displayName).trim() : fallbackNameFromEmail(email) || "NexUser");
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
  const old  = snap.exists() ? (snap.data() || {}) : {};
  const authName = isRealName(user.displayName) ? String(user.displayName).trim() : "";
  const oldName  = isRealName(old.name) ? String(old.name).trim() : "";
  const finalName = authName || oldName || (snap.exists() ? bestStoredName(old) : "");
  const finalEmail = user.email || old.email || "";
  const finalNexId = old.nexId || makeNexId(user.uid);
  const finalPhotoURL = old.photoURL || user.photoURL || "";
  const finalPhotoPublicId = old.photoPublicId || "";

  const tokenProfile = {
    uid: user.uid,
    name: finalName || bestStoredName({ email: finalEmail }),
    email: finalEmail,
    nexId: finalNexId
  };

  const writeData = {
    uid: user.uid,
    email: finalEmail,
    emailLower: normalizeSearchValue(finalEmail),
    nexId: finalNexId,
    nexIdLower: cleanPublicId(finalNexId),
    photoURL: finalPhotoURL,
    photoPublicId: finalPhotoPublicId,
    searchTokens: makeSearchTokens(tokenProfile),
    online:     true,
    lastSeen:   serverTimestamp(),
    lastActive: serverTimestamp()
  };

  if (finalName) {
    writeData.name = finalName;
    writeData.nameLower = normalizeSearchValue(finalName);
  }

  if (!snap.exists()) {
    await setDoc(ref, { ...writeData, createdAt: serverTimestamp() }, { merge: true });
  } else {
    await updateDoc(ref, writeData);
  }

  if (finalName) {
    await upsertUserLookup(user, {
      uid: user.uid,
      name: finalName,
      email: finalEmail,
      nexId: finalNexId,
      photoURL: finalPhotoURL,
      photoPublicId: finalPhotoPublicId
    });
  }
  rememberUserDoc(user.uid, { ...old, ...writeData, name: finalName || old.name || bestStoredName({ email: finalEmail }) });
}

export async function signUp(name, email, password, profileFile = null) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);

  await updateProfile(cred.user, { displayName: name });
  const profile = publicProfileFields(cred.user, { name, email });
  const userData = {
    ...profile,
    searchTokens: makeSearchTokens(profile),
    online:     true,
    lastSeen:   serverTimestamp(),
    lastActive: serverTimestamp(),
    createdAt:  serverTimestamp()
  };
  await setDoc(doc(db, COLLECTIONS.USERS, cred.user.uid), userData, { merge: true });
  await upsertUserLookup(cred.user, userData);
  rememberUserDoc(cred.user.uid, userData);
  if (profileFile) {
    await updateUserProfilePhoto(cred.user.uid, profileFile);
  }
  return cred.user;
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function updateUserProfilePhoto(uid, file) {
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error("You can only update your own profile picture.");
  }
  if (!file) throw new Error("No profile picture selected.");
  if (!String(file.type || "").startsWith("image/")) throw new Error("Please choose an image file.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Profile picture must be under 8 MB.");

  const uploaded = await uploadToCloudinary(file, `${uid}/profile`, "profile-picture.jpg", "nexchat,profile-photo");
  await updateProfile(auth.currentUser, { photoURL: uploaded.url });

  const userRef = doc(db, COLLECTIONS.USERS, uid);
  const snap = await getDoc(userRef);
  const old = snap.exists() ? (snap.data() || {}) : {};
  const profile = publicProfileFields(auth.currentUser, {
    name: bestStoredName({ ...old, displayName: auth.currentUser.displayName, email: old.email || auth.currentUser.email }),
    email: old.email || auth.currentUser.email || "",
    nexId: old.nexId || makeNexId(uid),
    photoURL: uploaded.url,
    photoPublicId: uploaded.publicId
  });

  await setDoc(userRef, {
    ...profile,
    searchTokens: makeSearchTokens(profile),
    updatedAt: serverTimestamp()
  }, { merge: true });

  await upsertUserLookup(auth.currentUser, profile);
  rememberUserDoc(uid, profile);

  try {
    const chatsSnap = await getDocs(query(collection(db, COLLECTIONS.CHATS), where("members", "array-contains", uid)));
    let batch = writeBatch(db);
    let count = 0;
    for (const chatDoc of chatsSnap.docs) {
      const chat = chatDoc.data() || {};
      batch.set(doc(db, COLLECTIONS.CHATS, chatDoc.id), {
        memberPhotos: { ...(chat.memberPhotos || {}), [uid]: uploaded.url }
      }, { merge: true });
      count += 1;
      if (count >= 450) { await batch.commit(); batch = writeBatch(db); count = 0; }
    }
    if (count) await batch.commit();
  } catch (err) {
    console.warn("Could not sync profile photo into old chats:", err);
  }

  return { ...profile, photoURL: uploaded.url, photoPublicId: uploaded.publicId };
}

export async function updateUserDisplayName(uid, newName) {
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error("You can only update your own username.");
  }
  const cleanName = String(newName || "").trim().replace(/\s+/g, " ");
  if (cleanName.length < 2) throw new Error("Username must be at least 2 characters.");
  if (cleanName.length > 40) throw new Error("Username can be maximum 40 characters.");

  await updateProfile(auth.currentUser, { displayName: cleanName });

  const userRef = doc(db, COLLECTIONS.USERS, uid);
  const userSnap = await getDoc(userRef);
  const old = userSnap.exists() ? (userSnap.data() || {}) : {};
  const photoURL = old.photoURL || old.profilePhotoURL || old.profilePhoto || old.profilePic || auth.currentUser.photoURL || "";
  const profile = publicProfileFields(auth.currentUser, {
    name: cleanName,
    email: old.email || auth.currentUser.email || "",
    nexId: old.nexId || makeNexId(uid),
    photoURL,
    photoPublicId: old.photoPublicId || ""
  });

  await setDoc(userRef, {
    ...profile,
    searchTokens: makeSearchTokens(profile),
    updatedAt: serverTimestamp()
  }, { merge: true });

  await upsertUserLookup(auth.currentUser, profile);

  try {
    const chatsSnap = await getDocs(query(collection(db, COLLECTIONS.CHATS), where("members", "array-contains", uid)));
    const updates = [];
    chatsSnap.forEach(chatDoc => {
      const chat = chatDoc.data() || {};
      updates.push(setDoc(doc(db, COLLECTIONS.CHATS, chatDoc.id), {
        memberNames: { ...(chat.memberNames || {}), [uid]: cleanName }
      }, { merge: true }));
    });
    await Promise.all(updates);
  } catch (err) {
    console.warn("Could not sync username into old chats:", err);
  }

  return cleanName;
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
      const safeName = bestStoredName(data);
      users.push({ id: uid, docId: d.id, ...data, name: safeName, uid });
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
  return getCachedUserDoc(uid);
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

async function bestNameForUid(uid, providedName = "") {
  try {
    const data = await getCachedUserDoc(uid);
    if (data) return bestStoredName(data);
  } catch (err) {
    console.warn("Could not read user name for chat:", err);
  }
  return isRealName(providedName) ? String(providedName).trim() : "NexUser";
}
async function bestPhotoForUid(uid) {
  try {
    const data = await getCachedUserDoc(uid);
    return data ? (data.photoURL || data.profilePhotoURL || data.profilePhoto || data.profilePic || "") : "";
  } catch (err) {
    console.warn("Could not read user photo for chat:", err);
    return "";
  }
}

export async function getOrCreateChat(myUid, myName, contactUid, contactName) {
  if (!myUid || !contactUid) throw new Error("Missing user id for chat.");
  if (myUid === contactUid) throw new Error("Cannot create a chat with yourself.");

  const chatId  = [myUid, contactUid].sort().join("_");
  const chatRef = doc(db, COLLECTIONS.CHATS, chatId);
  const myBestName = await bestNameForUid(myUid, myName);
  const contactBestName = await bestNameForUid(contactUid, contactName);
  const memberNames = { [myUid]: myBestName, [contactUid]: contactBestName };
  const memberPhotos = { [myUid]: await bestPhotoForUid(myUid), [contactUid]: await bestPhotoForUid(contactUid) };

  try {
    const snap = await getDoc(chatRef);
    if (snap.exists()) {
      const old = snap.data() || {};
      const oldNames = old.memberNames || {};
      const oldPhotos = old.memberPhotos || {};
      const needsNameFix = !isRealName(oldNames[myUid]) || !isRealName(oldNames[contactUid]) || oldNames[myUid] !== myBestName || oldNames[contactUid] !== contactBestName;
      const needsPhotoFix = (memberPhotos[myUid] && oldPhotos[myUid] !== memberPhotos[myUid]) || (memberPhotos[contactUid] && oldPhotos[contactUid] !== memberPhotos[contactUid]);
      if (needsNameFix || needsPhotoFix) {
        await setDoc(chatRef, { memberNames: { ...oldNames, ...memberNames }, memberPhotos: { ...oldPhotos, ...memberPhotos } }, { merge: true });
      }
      return chatId;
    }
  } catch (err) {
    if (err?.code !== "permission-denied") throw err;
    console.warn("Chat lookup denied; trying chat creation:", err);
  }

  await setDoc(chatRef, {
    members:         [myUid, contactUid],
    memberNames,
    memberPhotos,
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
      timestamp:  serverTimestamp(),
      seenBy:     [senderId],
      deletedFor: []
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
      storagePath: uploaded.publicId,
      seenBy:      [senderId],
      deletedFor:  []
    }
  );

  await updateDoc(doc(db, COLLECTIONS.CHATS, chatId), {
    lastMessage:     msgType === "image" ? "📷 Photo" : `📎 ${shortLastMessage(cleanName)}`,
    lastMessageTime: serverTimestamp(),
    lastSenderId:    senderId,
    lastSenderName:  senderName
  });
}

export async function sendGifMsg(chatId, senderId, senderName, gif = {}) {
  if (!chatId || !senderId || !gif?.url) throw new Error("No GIF selected.");
  const title = String(gif.title || "GIF").slice(0, 120);
  await addDoc(
    collection(db, COLLECTIONS.CHATS, chatId, COLLECTIONS.MESSAGES),
    {
      type:       "gif",
      text:       "",
      senderId,
      senderName,
      timestamp:  serverTimestamp(),
      fileName:   title || "GIF",
      fileUrl:    gif.url,
      fileType:   "image/gif",
      fileSize:   0,
      storagePath: gif.id ? `giphy:${gif.id}` : "giphy",
      gifId:      gif.id || "",
      gifTitle:   title,
      seenBy:     [senderId],
      deletedFor: []
    }
  );
  await updateDoc(doc(db, COLLECTIONS.CHATS, chatId), {
    lastMessage:     "GIF",
    lastMessageTime: serverTimestamp(),
    lastSenderId:    senderId,
    lastSenderName:  senderName
  });
}

export function stopMessagesListener() {
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
}

export async function markMessagesSeen(chatId, viewerId, messageIds = []) {
  if (!chatId || !viewerId || !Array.isArray(messageIds) || !messageIds.length) return;
  const uniqueIds = [...new Set(messageIds)].filter(Boolean).slice(0, 200);
  const batch = writeBatch(db);
  uniqueIds.forEach(id => {
    batch.update(doc(db, COLLECTIONS.CHATS, chatId, COLLECTIONS.MESSAGES, id), {
      seenBy: arrayUnion(viewerId)
    });
  });
  await batch.commit().catch(err => console.warn("Could not mark messages seen:", err));
}

export async function deleteMessagesForMe(chatId, myUid, messageIds = []) {
  if (!chatId || !myUid || !Array.isArray(messageIds) || !messageIds.length) return;
  const uniqueIds = [...new Set(messageIds)].filter(Boolean).slice(0, 450);
  const batch = writeBatch(db);
  uniqueIds.forEach(id => {
    batch.update(doc(db, COLLECTIONS.CHATS, chatId, COLLECTIONS.MESSAGES, id), {
      deletedFor: arrayUnion(myUid)
    });
  });
  await batch.commit();
}

export async function deleteMessagesForEveryone(chatId, messageIds = []) {
  if (!chatId || !Array.isArray(messageIds) || !messageIds.length) return;
  const uniqueIds = [...new Set(messageIds)].filter(Boolean).slice(0, 450);
  const batch = writeBatch(db);
  uniqueIds.forEach(id => batch.delete(doc(db, COLLECTIONS.CHATS, chatId, COLLECTIONS.MESSAGES, id)));
  batch.update(doc(db, COLLECTIONS.CHATS, chatId), {
    lastMessage: "Message deleted",
    lastMessageTime: serverTimestamp()
  });
  await batch.commit();
}

export async function deleteMessages(chatId, messageIds = []) {
  return deleteMessagesForEveryone(chatId, messageIds);
}

export async function deleteWholeChat(chatId) {
  if (!chatId) return;
  const msgSnap = await getDocs(collection(db, COLLECTIONS.CHATS, chatId, COLLECTIONS.MESSAGES));
  let batch = writeBatch(db);
  let count = 0;
  for (const d of msgSnap.docs) {
    batch.delete(d.ref);
    count += 1;
    if (count >= 450) { await batch.commit(); batch = writeBatch(db); count = 0; }
  }
  batch.delete(doc(db, COLLECTIONS.CHATS, chatId));
  await batch.commit();
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
  userDocCache.clear();
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
