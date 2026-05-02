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
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, COLLECTIONS } from "./config/config.js";
import {
  onAuthReady,
  onChatsUpdate,
  onMessagesUpdate
} from "./app.js";
// ── Initialize Firebase ──────────────────────────────────────
const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
const db    = getFirestore(fbApp);
// ── Internal State ───────────────────────────────────────────
let unsubMessages = null;
let unsubChats    = null;
let unsubStatus   = null;
// ════════════════════════════════════════════════════════════
//  AUTH — LISTENER
// ════════════════════════════════════════════════════════════
onAuthStateChanged(auth, async user => {
  try {
    if (user) {
      await ensureUserDoc(user);
      onAuthReady(user, true);
      startChatsListener(user.uid);
      loadAllUsersData(user.uid);
    } else {
      stopAllListeners();
      onAuthReady(null, false);
    }
  } catch (err) {
    console.error("Auth state error:", err);
    onAuthReady(user || null, !!user);
    if (typeof window.showToast === "function") {
      window.showToast("Firebase connection error. Check config and Firestore rules.");
    }
  }
});
// ── Ensure user document exists in Firestore ────────────────
async function ensureUserDoc(user) {
  const ref  = doc(db, COLLECTIONS.USERS, user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid:       user.uid,
      name:      user.displayName || "NexUser",
      email:     user.email,
      online:    true,
      lastSeen:  serverTimestamp(),
      createdAt: serverTimestamp()
    });
  } else {
    await updateDoc(ref, { online: true });
  }
}
// ════════════════════════════════════════════════════════════
//  AUTH — SIGN UP
// ════════════════════════════════════════════════════════════
export async function signUp(name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  await setDoc(doc(db, COLLECTIONS.USERS, cred.user.uid), {
    uid:       cred.user.uid,
    name,
    email,
    online:    true,
    lastSeen:  serverTimestamp(),
    createdAt: serverTimestamp()
  });
  return cred.user;
}
// ════════════════════════════════════════════════════════════
//  AUTH — SIGN IN
// ════════════════════════════════════════════════════════════
export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}
// ════════════════════════════════════════════════════════════
//  AUTH — SIGN OUT
// ════════════════════════════════════════════════════════════
export async function logOut(uid) {
  try {
    if (uid) {
      await updateDoc(doc(db, COLLECTIONS.USERS, uid), {
        online:   false,
        lastSeen: serverTimestamp()
      });
    }
  } catch (err) {
    console.warn("Could not update last seen before sign out:", err);
  }
  await signOut(auth);
}
// ════════════════════════════════════════════════════════════
//  USERS — Load all other users
// ════════════════════════════════════════════════════════════
export async function loadAllUsersData(currentUid) {
  if (!currentUid) return;
  try {
    const currentEmail = String(auth.currentUser?.email || "").toLowerCase();
    const snap = await getDocs(collection(db, COLLECTIONS.USERS));
    const seen = new Set();
    const users = [];
    snap.forEach(d => {
      const data = d.data();
      const email = String(data.email || "").toLowerCase();
      const uid = data.uid || d.id;
      const isMe = d.id === currentUid || uid === currentUid || (currentEmail && email === currentEmail);
      if (!isMe && !seen.has(uid)) {
        seen.add(uid);
        users.push({ id: d.id, ...data });
      }
    });
    users.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    // send to app.js
    if (typeof window.__onUsersLoaded === "function") {
      window.__onUsersLoaded(users);
    }
  } catch (err) {
    console.error("Load users error:", err);
    if (typeof window.showToast === "function") {
      window.showToast("Could not load users. Check Firestore rules.");
    }
  }
}
// ════════════════════════════════════════════════════════════
//  USERS — Get single user data
// ════════════════════════════════════════════════════════════
export async function getUserData(uid) {
  const snap = await getDoc(doc(db, COLLECTIONS.USERS, uid));
  return snap.exists() ? snap.data() : null;
}
// ════════════════════════════════════════════════════════════
//  CHATS — Listen to current user's chats
// ════════════════════════════════════════════════════════════
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
// ════════════════════════════════════════════════════════════
//  CHATS — Create or get chat between two users
// ════════════════════════════════════════════════════════════
export async function getOrCreateChat(myUid, myName, contactUid, contactName) {
  if (!myUid || !contactUid) throw new Error("Missing user id for chat.");
  if (myUid === contactUid) throw new Error("Cannot create a chat with yourself.");

  const chatId  = [myUid, contactUid].sort().join("_");
  const chatRef = doc(db, COLLECTIONS.CHATS, chatId);

  try {
    const snap = await getDoc(chatRef);
    if (snap.exists()) return chatId;
  } catch (err) {
    // Some rules deny reading a missing chat document. In that case, continue
    // and try to create the deterministic chat document below.
    if (err?.code !== "permission-denied") throw err;
    console.warn("Chat lookup denied; trying chat creation:", err);
  }

  await setDoc(chatRef, {
    members:         [myUid, contactUid],
    memberNames:     { [myUid]: myName, [contactUid]: contactName },
    lastMessage:     "",
    lastMessageTime: serverTimestamp(),
    createdAt:       serverTimestamp()
  });

  return chatId;
}

// ════════════════════════════════════════════════════════════
//  MESSAGES — Listen to messages in a chat
// ════════════════════════════════════════════════════════════
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
// ════════════════════════════════════════════════════════════
//  MESSAGES — Send a message
// ════════════════════════════════════════════════════════════
export async function sendMsg(chatId, senderId, senderName, text) {
  await addDoc(
    collection(db, COLLECTIONS.CHATS, chatId, COLLECTIONS.MESSAGES),
    { text, senderId, senderName, timestamp: serverTimestamp() }
  );
  await updateDoc(doc(db, COLLECTIONS.CHATS, chatId), {
    lastMessage:     text.length > 45 ? text.slice(0, 45) + "…" : text,
    lastMessageTime: serverTimestamp()
  });
}
// ════════════════════════════════════════════════════════════
//  PRESENCE — Watch contact's online status
// ════════════════════════════════════════════════════════════
export function watchContactStatus(contactUid, callback) {
  if (unsubStatus) unsubStatus();
  unsubStatus = onSnapshot(
    doc(db, COLLECTIONS.USERS, contactUid),
    snap => { if (snap.exists()) callback(snap.data()); },
    err => console.error("Status listener error:", err)
  );
}
// ════════════════════════════════════════════════════════════
//  CLEANUP
// ════════════════════════════════════════════════════════════
function stopAllListeners() {
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  if (unsubChats)    { unsubChats();    unsubChats    = null; }
  if (unsubStatus)   { unsubStatus();   unsubStatus   = null; }
}
// ── Friendly Auth Error Messages ────────────────────────────
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
    "permission-denied":           "Permission denied. Deploy Firestore rules."
  }[code] || "Something went wrong. Please try again.");
}