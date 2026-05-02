# NexChat Firebase Deployment Guide

## 1. Run locally

Open terminal in the main `NexChat` folder:

```bash
npm install
npm run dev
```

Then open the localhost URL shown by Vite.

## 2. Enable Firebase services

In Firebase Console for project `nexchat-db758`:

1. Go to **Authentication → Sign-in method**.
2. Enable **Email/Password**.
3. Go to **Firestore Database** and create the database.
4. Start in production mode. The included `firestore.rules` file will be deployed from this project.

Do not manually create users in Firestore. Sign up from the app. Each `/users/{uid}` document must use the same ID as the Firebase Auth UID.

## 3. Create the deployment folder

```bash
npm run build
```

This creates the `dist` folder. Firebase Hosting is configured to deploy only this folder.

## 4. Deploy

```bash
firebase login
firebase use nexchat-db758
firebase deploy --only hosting,firestore
```

Or use the shortcut:

```bash
npm run deploy
```

## 5. Test chat correctly

To test 1-to-1 chat, create two real accounts from the app:

- Account 1 in Chrome
- Account 2 in another browser, Incognito, or another device

After both accounts exist, open **New Conversation** and click the other user.

If clicking a user does nothing, redeploy rules:

```bash
firebase deploy --only firestore
```

Then refresh the app.
