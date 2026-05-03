# NexChat

Premium real-time chat app using Firebase Authentication, Cloud Firestore, Firebase Hosting, and Cloudinary uploads.

## Start locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy

```bash
firebase deploy --only hosting,firestore
```

## Cloudinary

Before sending photos/files, update `config/config.js` with your Cloudinary `cloudName` and unsigned `uploadPreset`.
