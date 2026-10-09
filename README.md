# Student Registration Portal

Node.js/Express application with a Neon PostgreSQL database and a Bootstrap frontend. It includes student signup and profiles, admin student CRUD, role-checked API routes, PDF Aadhaar upload, and email-based password resets.

## Local setup

1. Install Node.js 20 or newer and create a Neon PostgreSQL database.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, a random `JWT_SECRET` of at least 32 characters, and a strong `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
4. Run `npm install`, then `npm start` and open `http://localhost:3000`.
5. Configure SMTP in `.env` to send password-reset links. Without SMTP, local development returns a one-time reset URL in the response for testing. Production never exposes that URL.

The admin account is created on first startup only if its configured email does not already exist. The prior demo email `admin@admin.com` is rejected. To rotate credentials, use the authenticated reset flow for an existing administrator or update the MySQL password hash securely.

## MySQL and uploaded documents

Student data, bcrypt password hashes, reset-token hashes, and PDF bytes are stored in Neon PostgreSQL. Each PDF receives a generated UUID filename; for local assessment runs, a copy is also saved with that name in `uploads/` (which is excluded from Git). PDF routes require the student's login or an admin login and are never served from a public uploads directory. Vercel uses the persistent database copy rather than its temporary filesystem. Uploads are limited to 3 MB, and the server checks the PDF signature as well as the extension and MIME type.

The old SQLite `database.db` is not migrated automatically. It remains excluded from Git, along with local uploads and `.env`; do not publish those files or real student/Aadhaar data.

## Vercel deployment

1. Provision Neon PostgreSQL through the Vercel Marketplace and attach it to this Vercel project. The app creates its tables on startup; `init.sql` is provided if manual schema setup is preferred.
2. Push this sanitized source to a GitHub repository and import it into Vercel. Vercel detects the Express app exported from `server.js`; public pages and assets are in `public/`, while the protected dashboard templates are bundled from `views/` and only returned after role checks.
3. Add the variables from `.env.example` in Vercel Project Settings for the Production environment. Set `NODE_ENV=production`, a strong random `JWT_SECRET`, unique initial admin credentials, and `APP_URL` to the deployed HTTPS origin. The Neon integration supplies `DATABASE_URL`. Configure SMTP variables to enable password-reset email; signup and login can work before SMTP is set up.
4. Deploy, then test signup with a disposable account, duplicate-email handling, student/admin access denial, PDF access while logged in and logged out, CRUD, and a real email reset.

Never use real Aadhaar files in a public demo. Restrict access to the Vercel project and database, configure backups and retention, and confirm applicable privacy/legal requirements before handling real identity records.
