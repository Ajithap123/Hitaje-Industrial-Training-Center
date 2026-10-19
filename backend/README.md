# HITAJE GROUPS API + admin dashboard

Node.js 20+ backend for the new HITAJE GROUPS rebuild. It is independent of the original AppCreator24 service.

## Deploy with Render Blueprint

1. Put this project in a GitHub repository (the whole project, including `backend/`, `web/`, `android/`, and `render.yaml`).
2. Sign in to Render and create a **Blueprint** from that repository. Review `render.yaml` before confirming. This configuration uses a paid Starter web service because persistent disk storage is needed for JSON data.
3. When prompted, set `ADMIN_USERNAME` and `ADMIN_PASSWORD` to unique values. Render generates `JWT_SECRET` automatically. Do not share these credentials or commit them to Git.
4. Once deployed, open `https://YOUR-SERVICE.onrender.com/health`; expect JSON containing `"ok":true`.
5. Open `https://YOUR-SERVICE.onrender.com/` for the public UI and `/admin` for the admin dashboard. Log in with the admin credentials you set.
6. Update `android/app/src/main/assets/api-config.js` to set `window.HITAJE_API_BASE = 'https://YOUR-SERVICE.onrender.com';` then rebuild the APK in Android Studio. The browser UI automatically uses its own origin when hosted by the API service.

## Run locally

Requires Node.js 20+.

```sh
cd backend
npm install
```

Copy `.env.example` to `.env`, then set `JWT_SECRET` (at least 32 random characters), `ADMIN_USERNAME`, and a strong `ADMIN_PASSWORD`. Run `npm start`; open `http://localhost:8080/health`. The dotenv package loads `.env` automatically.

## API

- `GET /health`
- `GET /api/announcements` (published items)
- `GET /api/resources` (published items)
- `POST /api/contact` with `{ "name", "email", "message" }`
- `POST /api/admin/login` with `{ "username", "password" }`
- Authenticated admin CRUD at `/api/admin/announcements` and `/api/admin/resources`
- `GET /api/admin/contacts` (authenticated)

## Data and security notes

- Admin password is bcrypt-hashed in memory when `ADMIN_PASSWORD` is supplied, or you can provide `ADMIN_PASSWORD_HASH`.
- JWT sessions expire after 8 hours. API requests are rate limited and input lengths are constrained.
- JSON persistence is appropriate only for a small prototype. The Render configuration mounts a persistent disk at `/var/data`; do not remove that disk or data can be lost.
- CORS is currently permissive to support Android WebView's local-file origin. Admin writes still require a signed bearer token. For a stricter production deployment, host the web UI on the same origin and restrict CORS after testing Android WebView requests.
- Before collecting real personal enquiries, publish a privacy policy, limit access to enquiries, and arrange secure backups.

### Export form responses to CSV

Sign in to `/admin`, then use **Export responses to CSV** in the Contact enquiries / Form responses section. This downloads `hitaje-form-responses.csv`, which can be opened in Microsoft Excel or Google Sheets. The export is admin-authenticated and includes submission ID, name, email, message, UTC submission time, and status. It exports the contact/enquiry form submissions currently stored by the backend; registration responses are not included unless a registration endpoint is added.
