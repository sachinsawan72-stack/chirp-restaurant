# 🐦 Chirp Restaurant — Online Menu + Order System

Frontend + Backend (Node.js/Express) online restaurant menu with a working order API.

## Structure
```
chirp-restaurant/
├── server.js          # Backend (Express API)
├── package.json
├── data/
│   ├── menu.json       # Menu items (backend serves this)
│   └── orders.json     # Placed orders get saved here
└── public/
    ├── index.html       # Customer-facing menu (frontend)
    └── admin.html        # Owner dashboard to see orders
```

## Run locally
```
npm install
npm start
```
Open http://localhost:3000 for the menu, http://localhost:3000/admin.html for orders dashboard.
Default admin key: `chirp123` (change via `ADMIN_KEY` env var).

## API
- `GET /api/menu` — menu list
- `POST /api/orders` — place an order `{ items: [{id, quantity}], customerName, tableNumber }`
- `GET /api/admin/orders` — (needs header `x-admin-key`) all orders
- `PATCH /api/admin/orders/:id` — update order status
- `PATCH /api/admin/menu/:id` — update item image/price/description

## Deploy on Render
See step-by-step guide provided separately. In short:
1. Push this folder to a GitHub repo.
2. On Render: New → Web Service → connect the repo.
3. Build command: `npm install`, Start command: `npm start`.
4. Add environment variable `ADMIN_KEY` with a strong secret.
5. Deploy — Render gives you a live `https://your-app.onrender.com` URL.

⚠️ Note: Render's free tier disk is ephemeral (resets on redeploy/restart), so `orders.json`
data can be lost across deploys. For long-term production use with real order history,
swap the JSON file storage for a database (e.g. Render's free PostgreSQL, MongoDB Atlas, etc.).
