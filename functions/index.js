const { logger, setGlobalOptions } = require("firebase-functions/v2");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

const db = getFirestore();
const messaging = getMessaging();

async function getUserTokens(uid) {
  if (!uid) return [];
  const snap = await db.collection("users").doc(uid).collection("fcmTokens")
    .where("enabled", "==", true)
    .get();
  return snap.docs
    .map(doc => ({ id: doc.id, ref: doc.ref, token: doc.data()?.token }))
    .filter(row => row.token);
}

async function sendToUser(uid, payload) {
  const rows = await getUserTokens(uid);
  if (!rows.length) {
    logger.info("No FCM tokens for user", { uid });
    return;
  }

  const response = await messaging.sendEachForMulticast({
    tokens: rows.map(row => row.token),
    notification: payload.notification,
    data: payload.data,
    webpush: {
      fcmOptions: { link: payload.link || "/" },
      notification: {
        icon: "/nexchat-icon.svg",
        badge: "/nexchat-icon.svg",
        tag: payload.tag || "nexchat",
        renotify: true,
        requireInteraction: payload.requireInteraction || false,
        vibrate: payload.vibrate || [120]
      }
    }
  });

  const cleanup = [];
  response.responses.forEach((result, index) => {
    const code = result.error?.code || "";
    if (code.includes("registration-token-not-registered") || code.includes("invalid-registration-token")) {
      cleanup.push(rows[index].ref.delete());
    }
  });
  if (cleanup.length) await Promise.allSettled(cleanup);
  logger.info("Push notification sent", {
    uid,
    successCount: response.successCount,
    failureCount: response.failureCount
  });
}

exports.notifyNewMessage = onDocumentCreated("chats/{chatId}/messages/{messageId}", async event => {
  const msg = event.data?.data();
  if (!msg || !msg.senderId) return;

  const chatId = event.params.chatId;
  const chatSnap = await db.collection("chats").doc(chatId).get();
  if (!chatSnap.exists) return;

  const chat = chatSnap.data() || {};
  const recipients = Array.isArray(chat.members) ? chat.members.filter(uid => uid !== msg.senderId) : [];
  if (!recipients.length) return;

  const senderName = msg.senderName || chat.memberNames?.[msg.senderId] || "NexChat User";
  const body = msg.type === "image"
    ? "📷 Sent a photo"
    : msg.type === "file"
      ? `📎 ${msg.fileName || "Sent a file"}`
      : String(msg.text || "New message").slice(0, 120);

  await Promise.allSettled(recipients.map(uid => sendToUser(uid, {
    notification: { title: senderName, body },
    data: {
      type: "message",
      title: senderName,
      body,
      chatId,
      senderId: msg.senderId || "",
      url: "/"
    },
    tag: `chat-${chatId}`,
    link: "/",
    vibrate: [120]
  })));
});

exports.notifyIncomingCall = onDocumentCreated("calls/{callId}", async event => {
  const call = event.data?.data();
  if (!call || call.status !== "ringing" || !call.calleeId) return;

  const title = call.callerName || "NexChat Call";
  const body = call.type === "video" ? "Incoming video call" : "Incoming audio call";

  await sendToUser(call.calleeId, {
    notification: { title, body },
    data: {
      type: "call",
      title,
      body,
      callId: event.params.callId,
      chatId: call.chatId || "",
      callerId: call.callerId || "",
      url: "/"
    },
    tag: `call-${event.params.callId}`,
    link: "/",
    requireInteraction: true,
    vibrate: [250, 120, 250, 120, 250]
  });
});
