// ============================================================
//  NexChat Firebase Configuration
//  Firebase Web App config values are public identifiers.
//  Keep Security Rules strict to protect your Firestore data.
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyB1lJmDxxpTLuzvctNa8IHIOzeY7m0QVCA",
  authDomain: "nexchat-db758.firebaseapp.com",
  projectId: "nexchat-db758",
  storageBucket: "nexchat-db758.firebasestorage.app",
  messagingSenderId: "151305561819",
  appId: "1:151305561819:web:801cb9006d777f6c92cefe",
  measurementId: "G-VE735D2M5F"
};

export const COLLECTIONS = Object.freeze({
  USERS: "users",
  CHATS: "chats",
  MESSAGES: "messages"
});
