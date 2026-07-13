# VPN User Management Panel - Full Project Prompt

## Overview
Build a standalone VPN user management panel with Express + SQLite (sql.js) + WebSocket. The panel manages VPN users, parses subscription links, provides VLESS configs to users, includes a real-time chat system, and integrates with Telegram for automated backups and notifications.

## Tech Stack
- **Backend:** Node.js 20+, Express 4, WebSocket (ws), JWT auth, bcryptjs, multer (file uploads), node-cron
- **Database:** sql.js (pure JavaScript SQLite — no native compilation needed, works on any platform)
- **Frontend:** Vanilla HTML/CSS/JS (no framework), Vazirmatn font, Persian RTL, dark glass-morphism theme
- **Process Manager:** pm2
- **Reverse Proxy:** nginx
- **Deploy:** Ubuntu 22/24 VPS

## Database Schema

### users table
- id (INTEGER PRIMARY KEY AUTOINCREMENT)
- username (TEXT NOT NULL UNIQUE)
- display_name (TEXT)
- contact_type (TEXT: 'telegram' | 'bale' | 'whatsapp')
- contact_id (TEXT)
- subscription_links (TEXT JSON array of URLs)
- manual_vless (TEXT JSON array of VLESS strings)
- unlimited_volume (INTEGER 0/1)
- manual_days (INTEGER)
- vless_links (TEXT JSON array — for unlimited users)
- remaining_volume (TEXT: "26.14 GB" or "نامحدود")
- remaining_days (INTEGER)
- total_volume (TEXT)
- total_days (INTEGER)
- used_volume (TEXT)
- last_checked (TEXT ISO timestamp)
- sub_error (INTEGER 0/1)
- error_acked (INTEGER 0/1)
- suspended (INTEGER 0/1)
- last_data (TEXT JSON)
- config_overrides (TEXT JSON — per-config hide/rename)
- created_at, updated_at (TEXT)

### messages table
- id, user_id (FK), sender_type ('admin'|'user'), message, image, seen, created_at

### settings table
- key (TEXT PRIMARY KEY), value (TEXT)

### backups table
- id, filename, size, created_at

## API Endpoints

### Auth
- `POST /api/login` — Admin login with password, returns JWT
- `POST /api/user-login` — User login with username, returns JWT + user data
- `POST /api/change-password` — Change admin password
- `GET /api/debug` — Debug info (node version, db status, user count, settings)

### Users (admin only)
- `GET /api/users?sort=&dir=&search=` — List users with sorting/search
- `GET /api/users/:id` — User detail
- `POST /api/users` — Create user
- `PUT /api/users/:id` — Update user
- `DELETE /api/users/:id` — Delete user
- `POST /api/users/:id/suspend` — Suspend/unsuspend
- `POST /api/users/:id/ack-error` — Acknowledge subscription error
- `POST /api/users/:id/refresh` — Refresh subscription data
- `POST /api/users/refresh-all` — Refresh all subscriptions
- `GET /api/users/:id/configs-preview` — Preview configs with overrides applied
- `POST /api/users/:id/config-overrides` — Save config overrides (hide/show, rename)

### User-facing
- `GET /api/me` — Current user info
- `GET /api/me/configs` — All VLESS configs (overrides applied)
- `GET /api/me/messages` — Chat messages
- `GET /api/me/unread` — Unread admin message count
- `POST /api/messages/:userId` — Send message (REST fallback)
- `POST /api/upload-image` — Upload chat image
- `GET /sub/:username` — Base64-encoded subscription (with `subscription-userinfo` header)

### Settings
- `GET /api/settings` — All settings
- `POST /api/settings` — Update settings
- `GET /api/stats` — Dashboard stats (total, active, inactive, errors)
- `GET /api/backups` — Backup history

### Pages
- `/` — Landing page
- `/panel_h` — Admin panel (hidden path, configurable)
- `/u/:username` — User dashboard

## Frontend Features

### Admin Panel (`/panel_h`)
- **Login screen:** Password input, bcrypt verified
- **Sidebar nav:** Users, Chatroom, Add User, Backup, Telegram, Settings, Password
- **Users table:** Sortable columns, search (debounced), stats bar (active/inactive/errors), copy link, open link, contact buttons (Telegram/Bale/WhatsApp), suspend, edit modal, bulk delete
- **Add user form:** Username, contact type, contact ID, subscription links (textarea), manual VLESS (textarea), unlimited volume toggle, manual days
- **Edit modal:** Full user edit + "مشاهده و مدیریت کانفیگ‌ها" button that loads config list with:
  - Checkboxes to hide/show individual configs
  - Text input per config for individual rename
  - Bulk rename input (apply one name to all)
  - Save button for all overrides
- **Chatroom:** Real-time WebSocket chat with all users, photo upload, edit/delete messages, copy button per admin message
- **Settings:** Site URL, support ID, panel path, SSL cert upload, Telegram token/proxy/test

### User Dashboard (`/u/:username`)
- **Info cards:** Remaining volume (color-coded), remaining days, total volume
- **Status messages:** Suspension notice, expiry notice, volume depletion notice
- **Config count:** Shows number of available configs (not raw configs)
- **Copy all configs button:** Copies all VLESS text to clipboard
- **Sub URL display + copy:** Shows `http://domain/sub/username` for v2ray apps
- **Chat widget:** Real-time chat with admin, photo upload, floating button
- **Contact support:** Display support ID

### Styling
- Dark glass-morphism theme
- Vazirmatn font (via CDN)
- RTL layout
- Color variables: --bg, --card, --border, --text, --text-dim, --primary, --success, --warning, --danger
- Animations: fadeIn, slideUp, pulse
- Responsive: mobile-friendly sidebar collapse

## Subscription Parser (`sub-parser.js`)
- Fetches subscription URL via HTTP/HTTPS
- Parses `subscription-userinfo` header: `upload=...; download=...; total=...; expire=...`
- Decodes base64 body to get VLESS config lines
- Returns: { configs, allConfigs, upload, download, total, expire, remainingVolume, remainingDays }
- Aggregates multiple subscription links per user
- Handles HTTP errors gracefully (sets sub_error flag)

## Telegram Integration (`telegram.js`)
- Bot token and admin chat ID configurable
- Sends notifications: user created, user expired, subscription error
- Direct HTTP requests to Telegram API (with optional HTTP/SOCKS5 proxy)
- Test connection button in settings

## Backup System (`backup.js`)
- Creates ZIP archive of database + uploaded files
- Sends to Telegram chat via bot
- Scheduled every 5 minutes via node-cron
- Manual trigger from admin panel
- Backup history stored in database

## WebSocket Events
- `chat` — New message (with optional image)
- `message_edited` — Message edited
- `message_deleted` — Message deleted
- `refresh` — Data refresh notification (after subscription update)
- Connection: `ws://host/ws?token=JWT&type=admin|user`

## Content-Type Middleware
Critical: Must correctly set Content-Type based on file extension:
- `.css` → `text/css`
- `.js` → `application/javascript`
- `.html` → `text/html`
- Images → appropriate MIME types
- All with `charset=utf-8`

## Initialization Sequence (Critical)
```
1. Load modules
2. await db.init() — opens sql.js, loads WASM, runs schema migrations
3. Initialize JWT_SECRET from DB (or generate + save new one)
4. Initialize admin password (hash plaintext on first run)
5. Start Express server
6. Start cron jobs (subscription refresh every 1min, backup every 5min)
7. Initialize Telegram bot
```

## Deployment (Ubuntu VPS)
```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git nginx

# Clone and install
git clone <repo> /opt/vpn-panel
cd /opt/vpn-panel && npm install --production

# PM2
npm install -g pm2
PORT=3000 pm2 start server.js --name vpn-panel
pm2 save && pm2 startup

# Nginx reverse proxy
# Config: proxy_pass to 127.0.0.1:3000 with WebSocket support
```

## Key Configuration
- Admin password: configurable via panel (default: 427726)
- Panel path: configurable (default: /panel_h)
- Port: env PORT or 3000
- Telegram bot token + admin chat ID: configurable via settings
- Support ID: configurable
- SSL: optional cert upload

## Common Pitfalls Fixed
1. **sql.js get() returns empty object instead of null** — Must check `Object.keys(obj).length > 0`
2. **JWT_SECRET initialized before db.init()** — Must move to async init block
3. **Content-Type override middleware** — Must not force text/html on CSS/JS
4. **sql.js WASM loading** — Must read wasm file from node_modules and pass as wasmBinary
5. **Database persistence** — Must call saveDB() after every write operation
6. **Shell escaping in SSH** — Use heredoc or Node.js scripts for complex commands
