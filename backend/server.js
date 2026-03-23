const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/db');

dotenv.config();

// ── Global crash protection ──
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION] Server will continue running:', err.message);
    console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION] Server will continue running:', reason);
});

// Sanitize WEBHOOK_BASE_URL: strip any trailing slash to prevent double-slash in URLs
if (process.env.WEBHOOK_BASE_URL) {
    process.env.WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL.replace(/\/+$/, '');
    console.log(`🔗 WEBHOOK_BASE_URL: ${process.env.WEBHOOK_BASE_URL}`);
}

const {
    initiateCall,
    getCallDetails,
    pollForRecording,
    processInboundRecording,
    transcribeRecordingUrl,
    getDigitalDemocracyReply,
    synthesizeSpeech,
    saveResponseAudio
} = require('./services/exotelService');

// Ensure public/responses directory exists before any request can hit us
const responsesDir = path.join(__dirname, 'public', 'responses');
fs.mkdirSync(responsesDir, { recursive: true });
console.log(`📂 Ensured responses directory exists: ${responsesDir}`);

const app = express();

// Middleware
const allowedOriginPatterns = [
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/,
    /^https:\/\/[a-z0-9-]+\.ngrok-free\.dev$/,
    /^https:\/\/[a-z0-9-]+\.ngrok\.io$/
];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const isAllowed = allowedOriginPatterns.some((pattern) => pattern.test(origin));
        if (isAllowed) return callback(null, true);
        return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const color = res.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';
        console.log(`${color}${req.method}\x1b[0m ${req.originalUrl} → ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// Root health check
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'CivicSync API (MERN)',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Config endpoint to fetch public settings without hardcoding
app.get('/api/config', (req, res) => {
    res.json({
        helplineNumber: process.env.EXOTEL_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || "Not Configured",
        exotelNumber: process.env.EXOTEL_PHONE_NUMBER || "Not Configured",
        webhookBase: process.env.WEBHOOK_BASE_URL || "http://localhost:5000"
    });
});

// Outbound call trigger for frontend button
app.post('/initiate-call', async (req, res) => {
    try {
        const userPhoneNumber = req.body?.number;
        if (!userPhoneNumber) {
            return res.status(400).json({ message: 'Phone number is required in body as { number }' });
        }

        const call = await initiateCall(userPhoneNumber);
        return res.json({
            success: true,
            message: 'Call initiated successfully',
            callSid: call.sid,
            from: call.from,
            to: call.to,
            url: call.url
        });
    } catch (error) {
        const exotelMessage =
            error?.response?.data?.RestException?.Message ||
            error?.response?.data?.message ||
            error.message;
        console.error('[Exotel Initiate Call Error]', error?.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: exotelMessage || 'Failed to initiate call',
            detail: error?.response?.data || error.message
        });
    }
});

// In-memory set to prevent duplicate processing for the same call
const processedCalls = new Set();

// ──────────────────────────────────────────────────────────────
// ROUTE: /incoming-handler — ExoML Webhook
// ──────────────────────────────────────────────────────────────
app.all('/incoming-handler', (req, res) => {
    const callSid = req.query?.CallSid || req.body?.CallSid;
    const callFrom = req.query?.CallFrom || req.body?.CallFrom || req.query?.From || req.body?.From;
    const callTo = req.query?.CallTo || req.body?.CallTo || req.query?.To || req.body?.To;

    console.log('\n\n===================================');
    console.log('📞 INCOMING CALL (ExoML)');
    console.log('===================================');

    // Build the recording callback URL
    const baseUrl = process.env.WEBHOOK_BASE_URL || 'http://localhost:5000';
    const recordingDoneUrl = `${baseUrl}/recording-done`;

    const exoml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Namaste! CivicSync mein aapka swagat hai. Kripya beep ke baad apni shikayat batayen. Samaapt karne ke liye hash dabayen.</Say>
    <Record action="${recordingDoneUrl}" method="POST" maxLength="120" finishOnKey="#" playBeep="true" />
    <Say>Dhanyawad! Aapki shikayat darj ho gayi hai. Hum jald se jald samaadhaan karenge.</Say>
</Response>`;

    res.set('Content-Type', 'text/xml');
    res.status(200).send(exoml);
});

// ──────────────────────────────────────────────────────────────
// ROUTE: /recording-done — ExoML Record action callback
// ──────────────────────────────────────────────────────────────
app.all('/recording-done', (req, res) => {
    const callSid = req.query?.CallSid || req.body?.CallSid;
    const callFrom = req.query?.CallFrom || req.body?.CallFrom || req.query?.From || req.body?.From;
    const recordingUrl = req.query?.RecordingUrl || req.body?.RecordingUrl;

    const exoml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Dhanyawad! Aapki shikayat darj ho gayi hai. Hum jald se jald samaadhaan karenge.</Say>
    <Hangup />
</Response>`;

    res.set('Content-Type', 'text/xml');
    res.status(200).send(exoml);

    if (recordingUrl && callSid && !processedCalls.has(callSid)) {
        processedCalls.add(callSid);
        const callerPhone = callFrom || 'unknown';

        (async () => {
            try {
                console.log(`\n🔄 [REC-DONE] Processing recording for ${callerPhone}...`);
                const result = await processInboundRecording(recordingUrl, callerPhone);
                console.log(`✅ [REC-DONE] Ticket created: ${result.ticketNumber}`);
            } catch (err) {
                console.error(`❌ [REC-DONE] Failed:`, err.message);
            } finally {
                setTimeout(() => processedCalls.delete(callSid), 10 * 60 * 1000);
            }
        })();
    }
});

app.all('/call-status-callback', (req, res) => {
    const callSid = req.query?.CallSid || req.body?.CallSid;
    const callFrom = req.query?.CallFrom || req.body?.CallFrom || req.query?.From || req.body?.From;
    const recordingUrl = req.query?.RecordingUrl || req.body?.RecordingUrl;

    res.status(200).json({ status: 'received' });

    if (recordingUrl && callSid && !processedCalls.has(callSid)) {
        processedCalls.add(callSid);
        (async () => {
            try {
                await processInboundRecording(recordingUrl, callFrom || 'unknown');
            } catch (err) {
                console.error(`❌ [STATUS-CB] Failed:`, err.message);
            } finally {
                setTimeout(() => processedCalls.delete(callSid), 10 * 60 * 1000);
            }
        })();
    }
});

// Routes
const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const userRoutes = require('./routes/users');
const voiceRoutes = require('./routes/voice');
const smsRoutes = require('./routes/sms');

app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/users', userRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/sms', smsRoutes);

// 404 handler for unknown routes
app.use((req, res) => {
    res.status(404).json({ message: `Route ${req.method} ${req.originalUrl} not found` });
});

// Global error handler
app.use((err, req, res, _next) => {
    console.error('[Server Error]', err.stack);
    res.status(500).json({ message: 'Internal server error' });
});

// ── One-time migration: fix old users with empty phone & stale email index ──
async function runMigrations() {
    const User = require('./models/User');
    const collection = User.collection;

    // 1. Drop the old email_1 unique index if it exists (email is now optional)
    try {
        const indexes = await collection.indexes();
        const emailIndex = indexes.find(i => i.name === 'email_1');
        if (emailIndex) {
            await collection.dropIndex('email_1');
            console.log('[Migration] Dropped stale email_1 unique index');
        }
    } catch (e) {
        // Index may not exist, that's fine
    }

    // 2. Assign unique placeholder phones to old users who lack one
    try {
        const usersWithNoPhone = await User.find({
            $or: [{ phone: '' }, { phone: null }, { phone: { $exists: false } }]
        });
        for (const u of usersWithNoPhone) {
            const placeholder = `LEGACY_${u._id.toString().slice(-8)}`;
            u.phone = placeholder;
            await u.save({ validateBeforeSave: false });
            console.log(`[Migration] Assigned placeholder phone "${placeholder}" to user ${u.name} (${u._id})`);
        }
        if (usersWithNoPhone.length > 0) {
            console.log(`[Migration] Fixed ${usersWithNoPhone.length} users with missing phone`);
        }
    } catch (e) {
        console.error('[Migration] Error fixing empty phones:', e.message);
    }

    // 3. Ensure correct indexes exist
    try {
        await collection.createIndex({ phone: 1 }, { unique: true });
        console.log('[Migration] Ensured phone unique index');
    } catch (e) {
        // Index already exists
    }
}

// Connect DB then start server
const PORT = process.env.PORT || 5000;
connectDB().then(async () => {
    await runMigrations();
    app.listen(PORT, () => {
        console.log(`\n✅ [CivicSync] Server running on http://localhost:${PORT}`);
        console.log(`📊 [API Routes]`);
        console.log(`   POST /api/auth/register`);
        console.log(`   POST /api/auth/login`);
        console.log(`   GET  /api/auth/me`);
        console.log(`   POST /api/tickets/complaint`);
        console.log(`   GET  /api/tickets/my-complaints`);
        console.log(`   GET  /api/tickets/master`);
        console.log(`   PUT  /api/tickets/master/:id`);
        console.log(`   GET  /api/users`);
        console.log(`   PUT  /api/users/:id`);
        console.log(`📞 [Voice Endpoints]`);
        console.log(`   POST /api/voice/call-me             → Outbound via Twilio`);
        console.log(`   POST /api/voice/exotel-incoming      → Exotel inbound → Twilio bridge`);
        console.log(`   POST /api/voice/incoming             → Direct IVR (language select + record)`);
        console.log(`   POST /api/voice/language-selected    → Language choice handler`);
        console.log(`   POST /api/voice/recording-complete   → STT → AI → DB pipeline`);
        console.log(`   POST /api/voice/test-pipeline        → Test pipeline manually`);
        console.log(`   GET  /api/voice/status               → Service health check`);
        console.log(`🔗 [Webhook Base] ${process.env.WEBHOOK_BASE_URL || 'http://localhost:5000'}`);
        console.log(`☎️  [Exotel Number] ${process.env.EXOTEL_PHONE_NUMBER || 'Not configured'}\n`);
    });
});
