# ⚡ NexChat — Premium Dark Gold Messaging App

Real-time 1:1 chat using Firebase Authentication and Cloud Firestore.

## Run locally

```bash
npm install
npm run dev
```

## Build deployment files

```bash
npm run build
```

The build command creates the `dist` folder.

## Deploy

```bash
firebase login
firebase use nexchat-db758
firebase deploy --only hosting,firestore
```

Read `DEPLOYMENT.md` for the full guide.
