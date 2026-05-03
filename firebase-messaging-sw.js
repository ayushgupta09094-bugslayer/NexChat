importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyB1lJmDxxpTLuzvctNa8IHIOzeY7m0QVCA",
  authDomain: "nexchat-db758.firebaseapp.com",
  projectId: "nexchat-db758",
  storageBucket: "nexchat-db758.firebasestorage.app",
  messagingSenderId: "151305561819",
  appId: "1:151305561819:web:801cb9006d777f6c92cefe",
  measurementId: "G-VE735D2M5F"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const data = payload.data || {};
  const title = payload.notification?.title || data.title || "NexChat";
  const body = payload.notification?.body || data.body || "New activity on NexChat";
  const type = data.type || "message";

  self.registration.showNotification(title, {
    body,
    icon: "/nexchat-icon.svg",
    badge: "/nexchat-icon.svg",
    tag: data.chatId || data.callId || `nexchat-${type}`,
    renotify: true,
    vibrate: type === "call" ? [250, 120, 250, 120, 250] : [120],
    data: {
      url: data.url || "/",
      type,
      chatId: data.chatId || "",
      callId: data.callId || ""
    }
  });
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification?.data?.url || "/";
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      if ("focus" in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
