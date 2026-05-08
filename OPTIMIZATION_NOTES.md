# NexChat Optimization Notes

This version keeps the same UI and features while improving runtime smoothness.

## Optimized areas

- Batched Firestore writes for seen status, delete-for-me, delete-for-everyone, whole chat delete, username sync, and profile photo sync.
- Reduced repeated user profile reads with a short in-memory user document cache.
- Reduced DOM lookup overhead with cached element access.
- Reduced chat/message rerender work with render signatures and requestAnimationFrame scheduling.
- Replaced per-message download/select event listeners with one delegated listener on the message area.
- Added lazy/async image decoding for avatars, photos, and GIFs.
- Added CSS containment/content-visibility for smoother scrolling in chats, search results, and messages.
- Kept Cloudinary, GIPHY, seen/delete, camera, audio/video call, theme toggle, profile picture crop, username change, and Firebase deploy files unchanged in behavior.

Deploy with:

```powershell
npm run build
firebase deploy --only hosting,firestore
```
