# Alfie Fasting

A React + Vite fasting tracker web app built as a single-page app.

## Run locally

npm install
npm run dev

## App features

- Quick-start fast buttons for 16:8, 18:6, 20:4, 24h, 36h, 48h
- Live active fast timer with STOP NOW action
- Past fast logging modal with presets and note field
- Stats bar for total fasts, average duration, and longest fast
- History list with edit + delete management
- Safer active-fast handling with quick-start button guard and overlay close support
- Persistent storage via `window.storage.get/set` with fallback to `localStorage`