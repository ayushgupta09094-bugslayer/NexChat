# NexChat Firebase + Cloudinary Deployment

This build uses:

- Firebase Hosting
- Firebase Authentication
- Cloud Firestore
- Cloudinary for photos/files/profile pictures
- WebRTC + Firestore signaling for audio/video calls

Firebase Storage and Cloud Functions are not required in this version.

## 1. Cloudinary

Open `config/config.js` and confirm:

```js
export const CLOUDINARY_CONFIG = Object.freeze({
  cloudName: "dayaa7wrp",
  uploadPreset: "NexChat_upload",
  folder: "nexchat_uploads"
});
```

Use an unsigned upload preset. Do not put Cloudinary API secret in frontend code.

## 2. Build

```powershell
npm install
npm run build
```

## 3. Deploy

```powershell
firebase login
firebase use nexchat-db758
firebase deploy --only hosting,firestore
```

Do not deploy functions or storage for this version.

## 4. After deploy

Refresh the website with `Ctrl + F5`.

Video call end controls are available in three places: the top red call button, the bottom call controls, and the floating red end-call button. Pressing `Esc` on PC also ends the current call.
