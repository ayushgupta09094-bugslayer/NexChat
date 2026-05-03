# NexChat Firebase + Cloudinary Deployment

This ZIP keeps the previous NexChat UI and features, but file/photo uploads now use Cloudinary instead of Firebase Storage.

## 1. Install dependencies

```bash
npm install
```

## 2. Run locally

```bash
npm run dev
```

Open the local URL shown by Vite.

## 3. Firebase Console checklist

Enable these in your Firebase project:

1. Authentication → Sign-in method → Email/Password
2. Firestore Database → Create database

You do not need Firebase Storage for this version.

## 4. Cloudinary setup for files/photos

1. Open Cloudinary Dashboard.
2. Copy your Cloud name.
3. Go to Settings → Upload → Upload presets.
4. Create an unsigned upload preset.
5. Paste both values inside `config/config.js`:

```js
export const CLOUDINARY_CONFIG = Object.freeze({
  cloudName: "your_cloud_name",
  uploadPreset: "your_unsigned_upload_preset",
  folder: "nexchat_uploads"
});
```

Important: do not put your Cloudinary API secret in frontend code.

## 5. Build

```bash
npm run build
```

This creates the `dist` folder used by Firebase Hosting.

## 6. Deploy Firebase Hosting + Firestore

```bash
firebase login
firebase use nexchat-db758
firebase deploy --only hosting,firestore
```

Do not use `firebase deploy --only hosting,firestore,storage` in this Cloudinary version.

## What is included

- Real online/offline status using a Firestore heartbeat (`lastActive`).
- Users automatically become offline after they stop sending heartbeats.
- Local photo/file upload from your system using Cloudinary.
- Image preview inside chat bubbles.
- Download buttons for photos and documents inside chat bubbles.
- Search users by NexChat ID instead of showing all users.
- Audio calling and video calling using WebRTC + Firestore signaling.
- Mobile responsive chat layout improvements.

Maximum file upload size: 10 MB.


## Calling notes

Audio/video calling works on Firebase Hosting because it uses HTTPS. The browser will ask for microphone/camera permission. For best testing, open one account in normal Chrome and another account in Incognito or a different browser/device.

## User search notes

Open My Profile and copy your NexChat ID. Share that ID with another user. They can paste it in New Conversation to find you.
