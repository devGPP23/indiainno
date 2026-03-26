const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/db');

// Load env from root and backend so credentials work regardless of start directory.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

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

// Unified telephony adapter — auto-detects Exotel or Twilio
const telephonyAdapter = require('./services/telephonyAdapter');
// Full Exotel pipeline (call mgmt + STT + AI + TTS) — consolidated from old exotelService.js
const exotelService = require('./services/exotel');

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
        helplineNumber: telephonyAdapter.getHelplineNumber(),
        activeProvider: telephonyAdapter.getActiveProvider(),
        exotelNumber: process.env.EXOTEL_PHONE_NUMBER || 'Not Configured',
        webhookBase: process.env.WEBHOOK_BASE_URL || 'http://localhost:5000'
    });
});

// ── Backward-compatible /initiate-call alias ──
// Frontend may call POST /initiate-call directly; forward to exotel service.
app.post('/initiate-call', async (req, res) => {
    try {
        const userPhoneNumber = req.body?.number;
        if (!userPhoneNumber) {
            return res.status(400).json({ message: 'Phone number is required in body as { number }' });
        }

        const call = await exotelService.initiateCall(userPhoneNumber);
        return res.json({
            success: true,
            message: 'Call initiated successfully',
            callSid: call.sid,
            from: call.from,
            to: call.to,
            url: call.url
        });
    } catch (error) {
        const msg = error?.response?.data?.RestException?.Message ||
            error?.response?.data?.message || error.message;
        console.error('[Exotel Initiate Call Error]', error?.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: msg || 'Failed to initiate call',
            detail: error?.response?.data || error.message
        });
    }
});

// Routes
const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const userRoutes = require('./routes/users');
const voiceRoutes = require('./routes/voice');
const aiRoutes = require('./routes/ai_routes');
const smsRoutes = require('./routes/sms');
const implementationPlanRoutes = require('./routes/implementationPlans');

app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/users', userRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/implementation-plans', implementationPlanRoutes);

// 404 handler for unknown routes
app.use((req, res) => {
    res.status(404).json({ message: `Route ${req.method} ${req.originalUrl} not found` });
});

// Global error handler
app.use((err, req, res, _next) => {
    console.error('[Server Error]', err.stack);
    res.status(500).json({ message: 'Internal server error' });
});

// CronService for automated SLA deductions
const { startCronService } = require('./services/cronService');

// Connect DB then start server
const PORT = process.env.PORT || 5000;
connectDB().then(() => {
    startCronService();
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
        console.log(`   POST /api/voice/call-me             → Outbound call`);
        console.log(`   POST /api/voice/incoming             → IVR entry`);
        console.log(`   POST /api/voice/recording-complete   → STT → AI → DB`);
  console.log(` POST /api/voice/test-pipeline → Test pipeline`);
  console.log(` GET /api/voice/status → Service health`);
  console.log(`📋 [Implementation Plans]`);
  console.log(` POST /api/implementation-plans/create/:ticketId`);
  console.log(` GET  /api/implementation-plans/:ticketId`);
  console.log(` PUT  /api/implementation-plans/:planId/junior-review`);
  console.log(` PUT  /api/implementation-plans/:planId/senior-review`);
  console.log(` PUT  /api/implementation-plans/:planId/level1-approve`);
  console.log(` PUT  /api/implementation-plans/:planId/start-work`);
  console.log(` PUT  /api/implementation-plans/:planId/step-progress`);
  console.log(` PUT  /api/implementation-plans/:planId/verify-step`);
  console.log(` PUT  /api/implementation-plans/:planId/complete`);
  console.log(` PUT  /api/implementation-plans/:planId/final-verify`);
  console.log(`📡 [Provider] ${telephonyAdapter.getActiveProvider() || 'None configured'}`);
        console.log(`☎️  [Helpline] ${telephonyAdapter.getHelplineNumber()}`);
        console.log(`🔗 [Webhook]  ${process.env.WEBHOOK_BASE_URL || 'http://localhost:5000'}\n`);
    });
});
