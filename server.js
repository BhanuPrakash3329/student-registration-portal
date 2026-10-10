require('dotenv').config();

const express = require('express');
const { neon } = require('@neondatabase/serverless');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;
const SESSION_COOKIE = 'student_portal_session';
const MAX_PDF_SIZE = 3 * 1024 * 1024;
const uploadDir = path.join(__dirname, 'uploads');

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the Neon PostgreSQL connection string.');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('Set JWT_SECRET to a random value with at least 32 characters.');
}
if (isProduction && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD for the initial admin account.');
}
if (process.env.ADMIN_EMAIL && !process.env.ADMIN_PASSWORD) {
    throw new Error('Set ADMIN_PASSWORD when ADMIN_EMAIL is configured.');
}
if (process.env.ADMIN_PASSWORD &&
    (process.env.ADMIN_PASSWORD.length < 12 || Buffer.byteLength(process.env.ADMIN_PASSWORD, 'utf8') > 72)) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters and no more than 72 UTF-8 bytes.');
}
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD &&
    process.env.ADMIN_EMAIL.trim().toLowerCase() === 'admin@admin.com') {
    throw new Error('Choose a unique ADMIN_EMAIL; the old demo admin email is blocked.');
}
if (isProduction && !process.env.APP_URL) throw new Error('Set APP_URL to the deployed HTTPS origin.');

const sql = neon(process.env.DATABASE_URL);
const pool = {
    async query(text, values = []) {
        return { rows: await sql.query(text, values) };
    }
};

async function initializeDatabase() {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(254) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        dob DATE,
        gender VARCHAR(30),
        qualification VARCHAR(100),
        interests TEXT,
        class_name VARCHAR(100),
        subject VARCHAR(150),
        marks INTEGER,
        aadhar_filename VARCHAR(100),
        aadhar_data TEXT,
        role VARCHAR(10) NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'student')),
        auth_version INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token_hash CHAR(64) PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

    const column = await pool.query(
        "SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='aadhar_data'"
    );
    if (column.rows[0]?.data_type === 'bytea') {
        await pool.query(`ALTER TABLE users ALTER COLUMN aadhar_data TYPE TEXT
            USING CASE WHEN aadhar_data IS NULL THEN NULL ELSE encode(aadhar_data, 'base64') END`);
    }

    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
        const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
        const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
        await pool.query(
            `INSERT INTO users (name, email, password_hash, role)
             VALUES ('Admin', $1, $2, 'admin') ON CONFLICT (email) DO NOTHING`,
            [email, passwordHash]
        );
    }
}

let databaseInitError;
const databaseReady = initializeDatabase().catch((error) => {
    databaseInitError = error;
    console.error('Database initialization failed:', error.code || error.name);
    throw error;
});
databaseReady.catch(() => {});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PDF_SIZE, files: 1 },
    fileFilter: (req, file, callback) => {
        const isPdf = file.mimetype === 'application/pdf' &&
            path.extname(file.originalname).toLowerCase() === '.pdf';
        if (!isPdf) {
            const error = new Error('Only PDF files are allowed!');
            error.status = 400;
            return callback(error);
        }
        callback(null, true);
    }
});

const mailer = process.env.SMTP_HOST && process.env.SMTP_FROM
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD
        } : undefined
    })
    : null;

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());
app.get('/api/health', async (req, res) => {
    try {
        await databaseReady;
        res.json({ ok: true, database: 'connected' });
    } catch (error) {
        res.status(503).json({
            ok: false,
            database: 'unavailable',
            errorCode: databaseInitError?.code || databaseInitError?.name || 'UNKNOWN'
        });
    }
});
app.use(async (req, res, next) => {
    try {
        await databaseReady;
        next();
    } catch (error) {
        console.error('Database is unavailable:', error.message);
        res.status(503).json({ error: 'Database is temporarily unavailable.' });
    }
});

function setSessionCookie(res, token) {
    res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/',
        maxAge: 12 * 60 * 60 * 1000
    });
}

function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/'
    });
}

async function authenticate(req, res, next) {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) {
        return req.accepts('html') && req.path.endsWith('.html')
            ? res.redirect('/login.html')
            : res.status(401).json({ error: 'Please log in.' });
    }
    try {
        const claims = jwt.verify(token, process.env.JWT_SECRET);
        const { rows } = await pool.query(
            'SELECT id, email, role, auth_version FROM users WHERE id = $1 LIMIT 1',
            [claims.sub]
        );
        const account = rows[0];
        if (!account || account.auth_version !== claims.ver) {
            clearSessionCookie(res);
            if (req.accepts('html') && req.path.endsWith('.html')) return res.redirect('/login.html');
            return res.status(401).json({ error: 'Please log in again.' });
        }
        req.user = { id: account.id, email: account.email, role: account.role };
        next();
    } catch (error) {
        clearSessionCookie(res);
        if (req.accepts('html') && req.path.endsWith('.html')) return res.redirect('/login.html');
        return res.status(401).json({ error: 'Please log in again.' });
    }
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        if (req.accepts('html') && req.path.endsWith('.html')) return res.redirect('/student.html');
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
}

function requireAccountOrAdmin(req, res, next) {
    if (req.user.role !== 'admin' && String(req.user.id) !== String(req.params.id)) {
        return res.status(403).json({ error: 'You may only access your own account.' });
    }
    next();
}

app.get('/admin.html', authenticate, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});
app.get('/student.html', authenticate, (req, res) => {
    if (req.user.role !== 'student') return res.redirect('/login.html');
    res.sendFile(path.join(__dirname, 'views', 'student.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (req, res, next) => {
    if (isProduction && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const origin = req.get('origin');
        if (origin && new URL(origin).host !== req.get('host')) {
            return res.status(403).json({ error: 'Cross-origin request rejected.' });
        }
    }
    next();
});

function validPdf(file) {
    return file && file.buffer.length >= 5 && file.buffer.subarray(0, 5).toString() === '%PDF-';
}

async function persistLocalPdf(filename, buffer) {
    if (!isProduction) {
        await fs.promises.mkdir(uploadDir, { recursive: true });
        await fs.promises.writeFile(path.join(uploadDir, filename), buffer, { flag: 'wx' });
    }
}

async function removeLocalPdf(filename) {
    if (isProduction || !filename) return;
    try {
        await fs.promises.unlink(path.join(uploadDir, filename));
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('Could not remove local PDF:', error.message);
    }
}

function publicUser(row) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        dob: row.dob,
        gender: row.gender,
        qualification: row.qualification,
        interests: row.interests,
        class: row.class_name,
        subject: row.subject,
        marks: row.marks,
        has_aadhar: Boolean(row.aadhar_filename),
        role: row.role
    };
}

const studentFields = `id, name, email, dob::text AS dob, gender, qualification,
    interests, class_name, subject, marks, aadhar_filename, role`;

function getStudentInput(body) {
    const marks = body.marks === '' || body.marks == null ? null : Number(body.marks);
    if (marks !== null && (!Number.isInteger(marks) || marks < 0)) {
        return { error: 'Marks must be a non-negative whole number.' };
    }
    return {
        values: [
            String(body.name || '').trim(),
            body.dob || null,
            body.gender || null,
            body.qualification || null,
            body.interests || null,
            String(body.class || '').trim() || null,
            String(body.subject || '').trim() || null,
            marks
        ]
    };
}

app.post('/api/signup', upload.single('aadhar'), async (req, res) => {
    const { name, email, password, dob, gender, qualification, interests, class: studentClass, subject, marks } = req.body;
    if (!req.file || !validPdf(req.file)) {
        return res.status(400).json({ error: 'A valid Aadhaar PDF document is required.' });
    }
    if (!name || !email || !password || !dob || !gender || !qualification ||
        !studentClass || !subject || marks === undefined || marks === '') {
        return res.status(400).json({ error: 'Please complete all required fields.' });
    }
    if (password.length < 10 || Buffer.byteLength(password, 'utf8') > 72) {
        return res.status(400).json({ error: 'Password must be 10 or more characters (maximum 72 UTF-8 bytes).' });
    }
    const input = getStudentInput({ name, dob, gender, qualification, interests, class: studentClass, subject, marks });
    if (input.error) return res.status(400).json({ error: input.error });
    let savedFilename;
    try {
        const emailAddress = String(email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
            return res.status(400).json({ error: 'Enter a valid email address.' });
        }
        const passwordHash = await bcrypt.hash(password, 12);
        savedFilename = `aadhar-${crypto.randomUUID()}.pdf`;
        await persistLocalPdf(savedFilename, req.file.buffer);
        const { rows } = await pool.query(
            `INSERT INTO users
             (name, email, password_hash, dob, gender, qualification, interests, class_name, subject, marks, aadhar_filename, aadhar_data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id`,
            [input.values[0], emailAddress, passwordHash, ...input.values.slice(1), savedFilename, req.file.buffer.toString('base64')]
        );
        res.status(201).json({ success: true, message: 'Registration successful', userId: rows[0].id });
    } catch (error) {
        await removeLocalPdf(savedFilename);
        if (error.code === '23505') return res.status(400).json({ error: 'This email is already registered.' });
        console.error('Signup failed:', error.message);
        res.status(500).json({ error: 'Could not complete registration.' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const { rows } = await pool.query(
            'SELECT id, email, password_hash, role, auth_version FROM users WHERE email = $1 LIMIT 1',
            [email]
        );
        const account = rows[0];
        if (!account || !(await bcrypt.compare(req.body.password || '', account.password_hash))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign(
            { ver: account.auth_version },
            process.env.JWT_SECRET,
            { subject: String(account.id), expiresIn: '12h', issuer: 'student-registration-portal' }
        );
        setSessionCookie(res, token);
        res.json({ success: true, user: { id: account.id, email: account.email, role: account.role } });
    } catch (error) {
        console.error('Login failed:', error.message);
        res.status(500).json({ error: 'Could not log in.' });
    }
});

app.post('/api/logout', authenticate, async (req, res) => {
    try {
        await pool.query('UPDATE users SET auth_version = auth_version + 1 WHERE id = $1', [req.user.id]);
        clearSessionCookie(res);
        res.json({ success: true });
    } catch (error) {
        console.error('Logout failed:', error.message);
        res.status(500).json({ error: 'Could not log out.' });
    }
});

app.get('/api/me', authenticate, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            return res.json({ id: req.user.id, email: req.user.email, role: req.user.role });
        }
        const { rows } = await pool.query(
            `SELECT ${studentFields} FROM users WHERE id = $1 AND role = 'student' LIMIT 1`,
            [req.user.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
        res.json(publicUser(rows[0]));
    } catch (error) {
        console.error('Could not load current account:', error.message);
        res.status(500).json({ error: 'Could not load account.' });
    }
});

app.get('/api/admin/students', authenticate, requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT ${studentFields} FROM users WHERE role = 'student' ORDER BY id DESC`);
        res.json(rows.map(publicUser));
    } catch (error) {
        console.error('Could not list students:', error.message);
        res.status(500).json({ error: 'Could not load students.' });
    }
});

app.delete('/api/admin/student/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(
            "SELECT aadhar_filename FROM users WHERE id = $1 AND role = 'student' LIMIT 1",
            [req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Student not found.' });
        await pool.query("DELETE FROM users WHERE id = $1 AND role = 'student'", [req.params.id]);
        await removeLocalPdf(rows[0].aadhar_filename);
        res.json({ success: true, message: 'Student deleted' });
    } catch (error) {
        console.error('Could not delete student:', error.message);
        res.status(500).json({ error: 'Could not delete student.' });
    }
});

app.put('/api/admin/student/:id', authenticate, requireAdmin, async (req, res) => {
    const input = getStudentInput(req.body);
    if (input.error) return res.status(400).json({ error: input.error });
    try {
        const { rows } = await pool.query(
            "SELECT id FROM users WHERE id = $1 AND role = 'student' LIMIT 1", [req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Student not found.' });
        await pool.query(
            `UPDATE users SET dob=$1, gender=$2, qualification=$3, interests=$4,
             class_name=$5, subject=$6, marks=$7 WHERE id=$8 AND role='student'`,
            [...input.values.slice(1), req.params.id]
        );
        res.json({ success: true, message: 'Student updated' });
    } catch (error) {
        console.error('Could not update student:', error.message);
        res.status(500).json({ error: 'Could not update student.' });
    }
});

app.get('/api/student/:id', authenticate, requireAccountOrAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT ${studentFields} FROM users WHERE id=$1 AND role='student' LIMIT 1`, [req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'User not found' });
        res.json(publicUser(rows[0]));
    } catch (error) {
        console.error('Could not load student:', error.message);
        res.status(500).json({ error: 'Could not load student.' });
    }
});

app.put('/api/student/:id', authenticate, requireAccountOrAdmin, upload.single('aadhar'), async (req, res) => {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Only students can update their profiles.' });
    if (req.file && !validPdf(req.file)) return res.status(400).json({ error: 'Please upload a valid PDF file.' });
    if (!String(req.body.name || '').trim()) return res.status(400).json({ error: 'Name is required.' });
    const input = getStudentInput(req.body);
    if (input.error) return res.status(400).json({ error: input.error });
    let replacementFilename;
    try {
        const { rows } = await pool.query(
            "SELECT aadhar_filename FROM users WHERE id=$1 AND role='student' LIMIT 1", [req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'User not found' });
        let sql = `UPDATE users SET name=$1, dob=$2, gender=$3, qualification=$4,
            interests=$5, class_name=$6, subject=$7, marks=$8`;
        const values = input.values;
        if (req.file) {
            replacementFilename = `aadhar-${crypto.randomUUID()}.pdf`;
            await persistLocalPdf(replacementFilename, req.file.buffer);
            sql += ', aadhar_filename=$9, aadhar_data=$10 WHERE id=$11 AND role=\'student\'';
            values.push(replacementFilename, req.file.buffer.toString('base64'), req.params.id);
        } else {
            sql += ' WHERE id=$9 AND role=\'student\'';
            values.push(req.params.id);
        }
        await pool.query(sql, values);
        if (replacementFilename) await removeLocalPdf(rows[0].aadhar_filename);
        res.json({ success: true, message: 'Profile updated' });
    } catch (error) {
        await removeLocalPdf(replacementFilename);
        console.error('Could not update profile:', error.message);
        res.status(500).json({ error: 'Could not update profile.' });
    }
});

async function serveAadhar(req, res, next) {
    try {
        const { rows } = await pool.query(
            "SELECT aadhar_filename, aadhar_data FROM users WHERE id=$1 AND role='student' LIMIT 1",
            [req.params.id]
        );
        if (!rows[0] || !rows[0].aadhar_data) return res.status(404).json({ error: 'PDF not found.' });
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${rows[0].aadhar_filename}"`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        res.send(Buffer.from(rows[0].aadhar_data, 'base64'));
    } catch (error) {
        next(error);
    }
}

app.get('/api/student/:id/aadhar', authenticate, requireAccountOrAdmin, serveAadhar);
app.get('/api/admin/student/:id/aadhar', authenticate, requireAdmin, serveAadhar);

app.post('/api/forgot-password', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    if (!mailer && isProduction) return res.status(503).json({ error: 'Email password reset is not configured yet.' });
    try {
        const { rows } = await pool.query('SELECT id FROM users WHERE email=$1 LIMIT 1', [email]);
        if (rows[0]) {
            const rawToken = crypto.randomBytes(32).toString('hex');
            const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
            await pool.query('DELETE FROM password_reset_tokens WHERE user_id=$1', [rows[0].id]);
            await pool.query(
                "INSERT INTO password_reset_tokens (token_hash,user_id,expires_at) VALUES ($1,$2,NOW() + INTERVAL '30 minutes')",
                [tokenHash, rows[0].id]
            );
            const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
            const resetUrl = new URL('/reset-password.html', baseUrl);
            resetUrl.searchParams.set('token', rawToken);
            if (mailer) {
                await mailer.sendMail({
                    from: process.env.SMTP_FROM,
                    to: email,
                    subject: 'Reset your student portal password',
                    text: `Use this link within 30 minutes to reset your password: ${resetUrl}`
                });
            } else {
                if (isProduction) {
                    return res.status(503).json({ error: 'Email password reset is not configured yet.' });
                }
                return res.json({ success: true, message: 'Password reset link created.', resetUrl: resetUrl.toString() });
            }
        }
        res.json({ success: true, message: 'If the account exists, a password reset link has been sent.' });
    } catch (error) {
        console.error('Could not create password reset:', error.message);
        res.status(500).json({ error: 'Could not start password reset.' });
    }
});

app.post('/api/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    if (typeof token !== 'string' || typeof newPassword !== 'string' || newPassword.length < 10 ||
        Buffer.byteLength(newPassword, 'utf8') > 72) {
        return res.status(400).json({ error: 'Use a valid reset link and a password of 10 to 72 UTF-8 bytes.' });
    }
    try {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const passwordHash = await bcrypt.hash(newPassword, 12);
        const { rows } = await pool.query(
            `WITH valid_token AS (
                DELETE FROM password_reset_tokens
                WHERE token_hash=$1 AND expires_at>NOW()
                RETURNING user_id
            )
            UPDATE users
            SET password_hash=$2, auth_version=auth_version+1
            FROM valid_token
            WHERE users.id=valid_token.user_id
            RETURNING users.id`,
            [tokenHash, passwordHash]
        );
        if (!rows[0]) return res.status(400).json({ error: 'This reset link is invalid or expired.' });
        clearSessionCookie(res);
        res.json({ success: true, message: 'Password reset. Please log in with your new password.' });
    } catch (error) {
        console.error('Could not reset password:', error.message);
        res.status(500).json({ error: 'Could not reset password.' });
    }
});

app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE' ? 'PDF must be 3 MB or smaller.' : err.message;
        return res.status(400).json({ error: message });
    }
    if (err && err.status >= 400 && err.status < 500) {
        return res.status(err.status).json({ error: err.message || 'Invalid request.' });
    }
    if (err) {
        console.error('Unhandled request error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
    }
    next();
});

if (require.main === module) app.listen(PORT, () => console.log(`Server is running on http://localhost:${PORT}`));

module.exports = app;
