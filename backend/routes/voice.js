const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { MasterTicket, RawComplaint } = require('../models/Ticket');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');

let aiService;
try {
    aiService = require('../services/ai');
} catch (e) {
    console.warn('[Voice] AI service not available:', e.message);
}

const twilioService = require('../services/twilio');
const exotelService = require('../services/exotel');
const telephonyAdapter = require('../services/telephonyAdapter');

// ── In-memory mapping: phone/CallSid → userId (links calls to logged-in citizens) ──
const callUserMap = {};

const WEBHOOK_BASE = process.env.WEBHOOK_BASE_URL || 'http://localhost:5000';

// Use the adapter's isExotelConfigured instead of duplicating the check
const isExotelConfigured = telephonyAdapter.isExotelConfigured;

function getConfiguredProviderMode() {
    return (process.env.VOICE_OUTBOUND_PROVIDER || 'auto').toLowerCase();
}

function getOutboundProvider() {
    const mode = getConfiguredProviderMode();
    if (mode === 'twilio') return twilioService.isTwilioConfigured() ? 'twilio' : null;
    if (mode === 'exotel') return isExotelConfigured() ? 'exotel' : null;

    if (twilioService.isTwilioConfigured()) return 'twilio';
    if (isExotelConfigured()) return 'exotel';
    return null;
}

function useExotelDirectInbound() {
    const mode = (process.env.EXOTEL_INBOUND_MODE || '').toLowerCase();
    return mode === 'direct' || getConfiguredProviderMode() === 'exotel';
}

function buildLanguageMenuXml() {
    const languageMenuUrl = `${WEBHOOK_BASE}/api/voice/language-selected`;
    return xmlResponse(`
    <Say voice="Polly.Aditi">Welcome to Civic Sync, the Government Grievance Redressal System.</Say>
    <Gather numDigits="1" action="${languageMenuUrl}" method="POST" timeout="8">
        <Say voice="Polly.Aditi">Please select your language.</Say>
        <Say voice="Polly.Aditi">Press 1 for Hindi.</Say>
        <Say voice="Polly.Aditi">Press 2 for English.</Say>
        <Say voice="Polly.Aditi">Press 3 for Marathi.</Say>
        <Say voice="Polly.Aditi">Press 4 for Tamil.</Say>
        <Say voice="Polly.Aditi">Press 5 for Telugu.</Say>
        <Say voice="Polly.Aditi">Press 6 for Kannada.</Say>
        <Say voice="Polly.Aditi">Press 7 for Bengali.</Say>
    </Gather>
    <Say voice="Polly.Aditi">No input received. You can speak in any Indian language after the beep. Press the hash key when you are done.</Say>
    <Record maxLength="120" playBeep="true" action="${WEBHOOK_BASE}/api/voice/recording-complete" finishOnKey="#" trim="trim-silence" />
    <Say voice="Polly.Aditi">We did not receive your recording. Goodbye.</Say>
    `);
}

// Helper: Build XML response (works for both Twilio TwiML and Exotel)
function xmlResponse(innerXml) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${innerXml}\n</Response>`;
}

// Language config for IVR
const LANGUAGES = {
    '1': { name: 'Hindi', code: 'hi', greeting: 'Kripya apni shikayat spasht roop se batayein, sthan ya landmark bhi batayein. Hash key dabayein jab aap ho jayein.' },
    '2': { name: 'English', code: 'en', greeting: 'Please describe your complaint clearly, including the location or landmark. Press the hash key when you are done.' },
    '3': { name: 'Marathi', code: 'mr', greeting: 'Krupaya tumchi takraar spashta sanga, sthan kinva landmark suddha sanga. Zhalyavar hash key daba.' },
    '4': { name: 'Tamil', code: 'ta', greeting: 'Dayavu seydhu ungal pugazhchiyai thelivaga koorungal. Idam matrrum landmark aiyum koorungal. Mudinthathum hash key azuthungal.' },
    '5': { name: 'Telugu', code: 'te', greeting: 'Dayachesi mee phiryaadunu spastamga cheppandi. Sthalam mariyu landmark kuda cheppandi. Ayyaka hash key noppandi.' },
    '6': { name: 'Kannada', code: 'kn', greeting: 'Dayavittu nimma durudarige spashta aagi helhi. Sthala mattu landmark kuda helhi. Mugidaga hash key onnhi.' },
    '7': { name: 'Bengali', code: 'bn', greeting: 'Doya kore apnar obhijog porishkar bhabe bolun. Sthan ba landmark o bolun. Shesh hole hash key dabun.' },
};

// =============================================
// POST /api/voice/call-me — OUTBOUND via TWILIO
// Citizen clicks "Contact Authorities" in web app.
// Twilio calls their registered phone with Language Selection IVR.
// =============================================
router.post('/call-me', protect, async (req, res) => {
    try {
        const useDemoPhone = process.env.USE_DEMO_PHONE === 'true';
        const demoPhone = process.env.DEMO_PHONE_NUMBER;
        const userPhone = req.user.phone;

        const targetPhone = useDemoPhone
            ? (demoPhone || userPhone)
            : (userPhone || demoPhone);
        let formattedPhone = targetPhone;

        if (!formattedPhone || formattedPhone.length < 10) {
            return res.status(400).json({
                message: 'No valid phone number on your account. Please update your phone number in profile.',
                needsPhone: true
            });
        }

        // Normalize to E.164 +91XXXXXXXXXX
        formattedPhone = normalizePhone(formattedPhone);

        // Store user mapping so we can link the complaint later
        callUserMap[formattedPhone] = {
            userId: req.user._id,
            userName: req.user.name,
            userEmail: req.user.email,
            userCity: req.user.city || '',
            timestamp: Date.now(),
            source: 'web_contact_authorities'
        };

        const outboundProviderMode = getConfiguredProviderMode();
        const twilioConfigured = twilioService.isTwilioConfigured();
        const exotelConfigured = isExotelConfigured();
        const outboundProvider = getOutboundProvider();
        if (!outboundProvider) {
            return res.status(500).json({
                message: 'Calling service is not configured. Add Twilio (recommended for outbound callback) or Exotel credentials in .env.',
                errorCode: 'CALL_PROVIDER_NOT_CONFIGURED',
                providers: {
                    twilio: twilioConfigured,
                    exotel: exotelConfigured
                },
                diagnostics: {
                    outboundProviderMode,
                    selectedProvider: outboundProvider,
                    pid: process.pid
                }
            });
        }

        console.log(`[Voice] Outbound call request from ${req.user.email} -> ${formattedPhone} (via ${outboundProvider})`);

        let selectedProvider = outboundProvider;
        let call;
        try {
            call = selectedProvider === 'twilio'
                ? await twilioService.makeCall(formattedPhone)
                : await exotelService.makeCall(formattedPhone);
        } catch (primaryErr) {
            // In auto mode, fall back to the other provider if available
            if (outboundProviderMode === 'auto') {
                const fallback = selectedProvider === 'twilio' ? 'exotel' : 'twilio';
                const fallbackAvailable = fallback === 'exotel' ? exotelConfigured : twilioConfigured;

                if (fallbackAvailable) {
                    console.warn(`[Voice] ${selectedProvider} outbound failed (${primaryErr.code || primaryErr.message}); retrying with ${fallback}`);
                    selectedProvider = fallback;
                    call = fallback === 'twilio'
                        ? await twilioService.makeCall(formattedPhone)
                        : await exotelService.makeCall(formattedPhone);
                } else {
                    throw primaryErr;
                }
            } else {
                throw primaryErr;
            }
        }

        // Map CallSid to user as well
        if (call.callSid) {
            callUserMap[call.callSid] = callUserMap[formattedPhone];
        }

        res.json({
            success: true,
            message: `Call initiated! Your phone (${formattedPhone}) will ring shortly.`,
            callSid: call.callSid,
            provider: selectedProvider,
            diagnostics: {
                outboundProviderMode,
                selectedProvider,
                pid: process.pid
            }
        });

    } catch (err) {
        console.error('[Call-Me Error]', err);

        let userMessage = 'Failed to initiate call. Please try again.';
        let errorCode = 'CALL_INIT_FAILED';

        if (err.code === 'TWILIO_CONFIG_MISSING') {
            userMessage = 'Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env (root or backend/.env).';
            errorCode = err.code;
        } else if (err.code === 'EXOTEL_CONFIG_MISSING') {
            userMessage = 'Exotel is not configured. Set EXOTEL_ACCOUNT_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN, and EXOTEL_PHONE_NUMBER in .env.';
            errorCode = err.code;
        } else if (err.code === 'EXOTEL_AUTH_FAILED') {
            userMessage = 'Exotel authentication failed. Verify EXOTEL_API_KEY and EXOTEL_API_TOKEN.';
            errorCode = err.code;
        } else if (err.code === 20003) {
            userMessage = 'Twilio authentication failed. Check your TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.';
            errorCode = 'TWILIO_AUTH_FAILED';
        } else if (err.code === 21211 || err.code === 21214) {
            userMessage = 'Invalid phone number. Please update your phone number in profile (e.g. +919876543210).';
            errorCode = 'INVALID_PHONE';
        } else if (err.code === 21608 || err.code === 21610) {
            userMessage = 'This phone number is not verified on Twilio trial. Verify it at twilio.com/console/phone-numbers/verified.';
            errorCode = 'UNVERIFIED_PHONE';
        } else if (err.message?.includes('not a valid phone number')) {
            userMessage = 'Phone number format is invalid. Use format: +919876543210';
            errorCode = 'INVALID_PHONE';
        }

        res.status(500).json({
            message: userMessage,
            errorCode,
            providers: {
                twilio: twilioService.isTwilioConfigured(),
                exotel: isExotelConfigured()
            },
            diagnostics: {
                outboundProviderMode: getConfiguredProviderMode(),
                selectedProvider: getOutboundProvider(),
                pid: process.pid
            },
            detail: err.message
        });
    }
});

// =============================================
// POST/GET /api/voice/exotel-incoming — INBOUND via EXOTEL
// When someone dials the Exotel number (918047360814),
// Exotel Passthru Applet hits this webhook (GET with query params).
// We acknowledge and trigger Twilio to call them back.
// =============================================
router.all('/exotel-incoming', async (req, res) => {
    const params = { ...req.query, ...req.body };
    const callSid = params.CallSid || params.callsid || '';
    const callerPhone = params.CallFrom || params.From || params.Caller || '';
    const exotelCallTo = params.CallTo || params.To || '';

    console.log(`[Voice] ☎️ Exotel inbound call — CallSid: ${callSid}, From: ${callerPhone}, To: ${exotelCallTo}`);
    console.log(`[Voice] Exotel full body:`, JSON.stringify(req.body, null, 2));

    if (useExotelDirectInbound()) {
        // Exotel-only path: keep caller in the same call and run IVR directly.
        return res.type('text/xml').send(buildLanguageMenuXml());
    }

    // Bridge mode: acknowledge Exotel call and trigger callback provider (Twilio by default).
    const xml = xmlResponse(`
    <Say>Welcome to Civic Sync, Government Grievance Redressal System. You will receive a call back shortly to register your complaint. Please keep your phone ready. Thank you.</Say>
    <Hangup/>
    `);
    res.type('text/xml').send(xml);

    // ── Async: Bridge to Twilio ──
    (async () => {
        try {
            if (!callerPhone) {
                console.warn('[Voice] Exotel bridge: No caller phone received, skipping Twilio callback');
                return;
            }

            // Use demo phone for Twilio trial (only verified numbers work)
            const useDemoPhone = process.env.USE_DEMO_PHONE === 'true';
            const demoPhone = process.env.DEMO_PHONE_NUMBER;
            const callerNormalized = normalizePhone(callerPhone);
            const formattedPhone = (useDemoPhone && demoPhone) ? normalizePhone(demoPhone) : callerNormalized;
            console.log(`[Voice] Exotel→Twilio bridge: Caller: ${callerNormalized}, Calling: ${formattedPhone}${useDemoPhone ? ' (demo override)' : ''}`);

            // Look up user by phone number
            const normalizedDigits = callerPhone.replace(/\D/g, '');
            const phoneVariants = [
                callerPhone,
                `+${normalizedDigits}`,
                `+91${normalizedDigits.slice(-10)}`,
                normalizedDigits.slice(-10),
            ];
            const user = await User.findOne({ phone: { $in: phoneVariants } });

            // Store mapping so complaint links to user
            callUserMap[formattedPhone] = {
                userId: user?._id || null,
                userName: user?.name || 'Exotel Caller',
                userEmail: user?.email || '',
                userCity: user?.city || '',
                userPhone: formattedPhone,
                timestamp: Date.now(),
                source: 'exotel_inbound'
            };

            if (user) {
                console.log(`[Voice] Exotel bridge: Matched caller ${callerPhone} → ${user.email} (${user.name})`);
            } else {
                console.log(`[Voice] Exotel bridge: No registered user found for ${callerPhone}, will register as anonymous`);
            }

            // Wait for Exotel call to fully disconnect before Twilio calls back
            console.log(`[Voice] Exotel→Twilio bridge: Waiting 4s for Exotel call to end...`);
            await new Promise(resolve => setTimeout(resolve, 4000));

            // Trigger Twilio outbound call with IVR
            const twilioService = require('../services/twilio');
            const call = await twilioService.makeCall(formattedPhone);

            if (call.callSid) {
                callUserMap[call.callSid] = callUserMap[formattedPhone];
                console.log(`[Voice] ✅ Exotel→Twilio bridge SUCCESS: ${formattedPhone} → Twilio SID: ${call.callSid}`);
            }

        } catch (err) {
            console.error('[Voice] ❌ Exotel→Twilio bridge FAILED:', err.message);
            console.error('[Voice] Bridge error details:', err);
        }
    })();
});

// =============================================
// POST /api/voice/incoming — DIRECT INBOUND IVR
// Generic webhook for both Twilio and Exotel inbound calls.
// Starts with language selection, then records complaint.
// =============================================
router.post('/incoming', (req, res) => {
    const callSid = req.body.CallSid || req.body.callsid || '';
    const callerPhone = req.body.CallFrom || req.body.From || req.body.Caller || '';
    const isTwilio = !!req.body.AccountSid;

    console.log(`[Voice] Inbound call webhook — CallSid: ${callSid}, From: ${callerPhone}, Provider: ${isTwilio ? 'twilio' : 'exotel'}`);

    // Try to link to existing user by phone
    if (callerPhone) {
        if (callUserMap[callerPhone]) {
            callUserMap[callSid] = callUserMap[callerPhone];
        } else {
            const normalizedPhone = callerPhone.replace(/\D/g, '');
            const phoneVariants = [
                callerPhone,
                `+${normalizedPhone}`,
                `+91${normalizedPhone.slice(-10)}`,
                normalizedPhone.slice(-10),
            ];

            User.findOne({ phone: { $in: phoneVariants } })
                .then(user => {
                    if (user) {
                        callUserMap[callSid] = {
                            userId: user._id,
                            userName: user.name,
                            userEmail: user.email,
                            userCity: user.city || '',
                            timestamp: Date.now()
                        };
                        console.log(`[Voice] Matched inbound caller ${callerPhone} → ${user.email}`);
                    }
                })
                .catch(err => console.warn('[Voice] User lookup failed:', err.message));
        }
    }

    // IVR: Language selection → Record
    res.type('text/xml').send(buildLanguageMenuXml());
});

// =============================================
// POST /api/voice/language-selected — IVR language choice
// After user presses a digit, play language-specific greeting and record.
// =============================================
router.post('/language-selected', (req, res) => {
    const digit = req.body.Digits || '2';
    const callSid = req.body.CallSid || req.body.callsid || '';

    const lang = LANGUAGES[digit] || LANGUAGES['2'];

    console.log(`[Voice] Language selected: ${lang.name} (digit: ${digit}) — CallSid: ${callSid}`);

    // Store language preference in call mapping
    if (callUserMap[callSid]) {
        callUserMap[callSid].language = lang.code;
        callUserMap[callSid].languageName = lang.name;
    } else {
        // Create mapping if doesn't exist
        callUserMap[callSid] = {
            language: lang.code,
            languageName: lang.name,
            timestamp: Date.now()
        };
    }

    const recordingCallbackUrl = `${WEBHOOK_BASE}/api/voice/recording-complete`;

    const xml = xmlResponse(`
    <Say voice="Polly.Aditi">You selected ${lang.name}.</Say>
    <Say voice="Polly.Aditi">${lang.greeting}</Say>
    <Record maxLength="120" playBeep="true" action="${recordingCallbackUrl}" finishOnKey="#" trim="trim-silence" />
    <Say voice="Polly.Aditi">We did not receive your recording. Goodbye.</Say>
    `);

    res.type('text/xml').send(xml);
});

// =============================================
// POST /api/voice/recording-complete — Process recording
// Called by BOTH Twilio and Exotel after recording finishes.
// Pipeline: Sarvam STT → Groq Classification → Save to DB
// =============================================
router.post('/recording-complete', async (req, res) => {
    const callSid = req.body.CallSid || req.body.callsid || '';
    const recordingUrl = req.body.RecordingUrl || req.body.RecordUrl || '';
    const callerPhone = req.body.CallFrom || req.body.From || req.body.Caller || '';
    const isTwilio = !!req.body.AccountSid;

    console.log(`[Voice] 🎙️ Recording complete — CallSid: ${callSid}, From: ${callerPhone}, Provider: ${isTwilio ? 'twilio' : 'exotel'}`);
    console.log(`[Voice] Recording URL: ${recordingUrl}`);

    // Respond immediately (say goodbye) so the call ends cleanly
    const xml = xmlResponse(`
    <Say voice="Polly.Aditi">Thank you. Your complaint has been registered successfully. You will see it on your dashboard shortly. Goodbye.</Say>
    `);
    res.type('text/xml').send(xml);

    // ── Async processing pipeline ──
    try {
        // Find user from our mapping
        let userId = null;
        let userCity = '';
        let selectedLanguage = 'unknown';
        let callSource = 'voice_call';

        // Try CallSid mapping first
        if (callUserMap[callSid]) {
            userId = callUserMap[callSid].userId;
            userCity = callUserMap[callSid].userCity || '';
            selectedLanguage = callUserMap[callSid].language || 'unknown';
            callSource = callUserMap[callSid].source || 'voice_call';
        }
        // Try phone mapping
        if (!userId && callerPhone) {
            const normalizedCaller = normalizePhone(callerPhone);
            if (callUserMap[normalizedCaller]) {
                userId = callUserMap[normalizedCaller].userId;
                userCity = callUserMap[normalizedCaller].userCity || '';
                selectedLanguage = callUserMap[normalizedCaller].language || selectedLanguage;
                callSource = callUserMap[normalizedCaller].source || callSource;
            }
        }
        // Last resort: DB lookup by phone
        if (!userId && callerPhone) {
            const normalizedPhone = callerPhone.replace(/\D/g, '');
            const phoneVariants = [
                callerPhone,
                `+${normalizedPhone}`,
                `+91${normalizedPhone.slice(-10)}`,
                normalizedPhone.slice(-10),
            ];
            const user = await User.findOne({ phone: { $in: phoneVariants } });
            if (user) {
                userId = user._id;
                userCity = user.city || '';
                console.log(`[Voice] Matched caller ${callerPhone} → user ${user.email}`);
            }
        }

        if (!recordingUrl) {
            console.warn('[Voice] No recording URL received, skipping processing');
            return;
        }

        // For Twilio recordings, append .wav for proper format
        let audioUrl = recordingUrl;
        if (isTwilio && !recordingUrl.endsWith('.wav') && !recordingUrl.endsWith('.mp3')) {
            audioUrl = recordingUrl + '.wav';
        }

        console.log(`[Voice] Processing audio: ${audioUrl} (language: ${selectedLanguage}, source: ${callSource})`);

        // ── STEP 1: Sarvam AI — Speech to Text ──
        let transcriptText = 'Voice complaint (transcription pending)';
        let detectedLanguage = selectedLanguage;
        if (aiService) {
            try {
                const sttResult = await aiService.speechToText(audioUrl);
                transcriptText = sttResult.transcript || transcriptText;
                detectedLanguage = sttResult.language || detectedLanguage;
                console.log(`[Voice] ✅ Sarvam transcript: "${transcriptText}" (lang: ${detectedLanguage})`);
            } catch (sttErr) {
                console.warn('[Voice] ⚠️ Sarvam STT failed:', sttErr.message);
            }
        }

        // ── STEP 2: Groq — Classify complaint into department + category ──
        let classification = {
            intentCategory: 'Other',
            department: 'municipal',
            landmark: '',
            description: transcriptText,
            severity: 'Low'
        };
        if (aiService && transcriptText !== 'Voice complaint (transcription pending)') {
            try {
                classification = await aiService.classifyComplaint(transcriptText);
                console.log(`[Voice] ✅ Groq classification: dept=${classification.department}, cat=${classification.intentCategory}, severity=${classification.severity}`);
            } catch (classErr) {
                console.warn('[Voice] ⚠️ Groq classification failed:', classErr.message);
            }
        }

        // ── STEP 3: Save to Database ──
        const ticketNumber = 'TKT-' + Math.floor(100000 + Math.random() * 900000);

        const ticket = new MasterTicket({
            intentCategory: classification.intentCategory || 'Other',
            description: classification.description || transcriptText,
            severity: classification.severity || 'Low',
            complaintCount: 1,
            status: 'Open',
            needsManualGeo: true,
            landmark: classification.landmark || 'From voice call — needs review',
            audioUrl: audioUrl,
            department: classification.department || null,
            city: userCity,
            ticketNumber,
        });
        await ticket.save();

        const callerHash = callerPhone
            ? crypto.createHash('sha256').update(callerPhone).digest('hex')
            : 'unknown';

        const rawComplaint = new RawComplaint({
            userId: userId || undefined,
            callerPhone: callerHash,
            callerPhoneRaw: callerPhone || '',
            audioUrl: audioUrl,
            status: 'Open',
            source: 'voice_call',
            transcriptOriginal: transcriptText,
            transcriptEnglish: classification.description || transcriptText,
            intentCategory: classification.intentCategory || 'Other',
            extractedLandmark: classification.landmark || '',
            department: classification.department || null,
            masterTicketId: ticket._id
        });
        await rawComplaint.save();

        console.log(`[Voice] ✅ Complaint saved: ${ticketNumber} | Dept: ${classification.department} | Category: ${classification.intentCategory} | Language: ${detectedLanguage} | Source: ${callSource} | User: ${userId || 'anonymous-inbound'}`);

        // Cleanup session
        delete callUserMap[callSid];

    } catch (err) {
        console.error('[Voice Pipeline Error]', err);
    }
});

// =============================================
// POST /api/voice/call-status — Status callback (Twilio + Exotel)
// =============================================
router.post('/call-status', (req, res) => {
    const callSid = req.body.CallSid || req.body.callsid || '';
    const status = req.body.CallStatus || req.body.Status || '';
    const duration = req.body.CallDuration || req.body.Duration || '0';
    console.log(`[Voice] Call ${callSid} status: ${status} (duration: ${duration}s)`);
    res.sendStatus(200);
});

// =============================================
// GET /api/voice/status — Check service availability
// =============================================
router.get('/status', (req, res) => {
    const hasSarvam = !!process.env.SARVAM_API_KEY;
    const hasGroq = !!process.env.GROQ_API_KEY;
    const hasExotel = isExotelConfigured();

    // Proper Twilio validation — SID must start with AC, no placeholders
    let hasTwilio = false;
    try {
        hasTwilio = twilioService.isTwilioConfigured();
    } catch (e) {
        hasTwilio = false;
    }

    res.json({
        available: (hasTwilio || hasExotel) && hasSarvam && hasGroq,
        outboundProviderMode: getConfiguredProviderMode(),
        exotelInboundMode: useExotelDirectInbound() ? 'direct' : 'bridge',
        twilio: hasTwilio,
        twilioNote: !hasTwilio ? 'Set real TWILIO_ACCOUNT_SID (starts with AC), TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in .env' : 'OK',
        exotel: hasExotel,
        sarvam: hasSarvam,
        groq: hasGroq,
        webhookBase: WEBHOOK_BASE,
        endpoints: {
            outbound: 'POST /api/voice/call-me (Twilio preferred, Exotel fallback)',
            exotelInbound: 'POST /api/voice/exotel-incoming (Exotel → Twilio bridge)',
            directInbound: 'POST /api/voice/incoming (Twilio/Exotel IVR)',
            languageSelect: 'POST /api/voice/language-selected',
            recordingComplete: 'POST /api/voice/recording-complete',
        },
        exotelNumber: process.env.EXOTEL_PHONE_NUMBER || 'Not configured',
        message: [
            getConfiguredProviderMode() === 'twilio' && !hasTwilio ? 'TWILIO creds missing/invalid (required by VOICE_OUTBOUND_PROVIDER=twilio)' : null,
            !hasExotel ? 'EXOTEL creds missing (inbound calls)' : null,
            !hasSarvam ? 'SARVAM_API_KEY missing' : null,
            !hasGroq ? 'GROQ_API_KEY missing' : null,
        ].filter(Boolean).join(', ') || 'All services ready ✅'
    });
});

// =============================================
// POST /api/voice/test-pipeline — Test the full pipeline manually
// Simulates a complaint going through STT → Classification → DB
// =============================================
router.post('/test-pipeline', protect, async (req, res) => {
    const { transcript, language, phone } = req.body;
    const testTranscript = transcript || 'There is a large pothole on MG Road near City Mall, it has been there for two weeks and is causing accidents.';

    console.log(`[Voice Test] Running pipeline test with transcript: "${testTranscript}"`);

    try {
        // STEP 1: Groq Classification
        let classification = {
            intentCategory: 'Other',
            department: 'municipal',
            landmark: '',
            description: testTranscript,
            severity: 'Low'
        };

        if (aiService) {
            classification = await aiService.classifyComplaint(testTranscript);
            console.log(`[Voice Test] Groq result:`, classification);
        }

        // STEP 2: Save to DB
        const ticketNumber = 'TKT-TEST-' + Math.floor(100000 + Math.random() * 900000);

        const ticket = new MasterTicket({
            intentCategory: classification.intentCategory || 'Other',
            description: classification.description || testTranscript,
            severity: classification.severity || 'Low',
            complaintCount: 1,
            status: 'Open',
            needsManualGeo: true,
            landmark: classification.landmark || 'Test complaint — needs review',
            department: classification.department || null,
            city: req.user.city || '',
            ticketNumber,
        });
        await ticket.save();

        const rawComplaint = new RawComplaint({
            userId: req.user._id,
            status: 'Open',
            source: 'voice_call',
            transcriptOriginal: testTranscript,
            transcriptEnglish: classification.description || testTranscript,
            intentCategory: classification.intentCategory || 'Other',
            extractedLandmark: classification.landmark || '',
            department: classification.department || null,
            masterTicketId: ticket._id
        });
        await rawComplaint.save();

        console.log(`[Voice Test] ✅ Test complaint saved: ${ticketNumber}`);

        res.json({
            success: true,
            ticketNumber,
            classification,
            message: `Test complaint saved! Check dashboards for ticket ${ticketNumber}.`,
            ticket: { id: ticket._id, ...ticket.toObject() }
        });
    } catch (err) {
        console.error('[Voice Test Error]', err);
        res.status(500).json({ message: err.message });
    }
});

// ── Helper: Normalize phone number to E.164 ──
function normalizePhone(phone) {
    let formatted = String(phone || '').trim();
    const digitsOnly = formatted.replace(/\D/g, '');
    // 10 digits: Indian mobile without prefix
    if (digitsOnly.length === 10) {
        return `+91${digitsOnly}`;
    }
    // 11 digits starting with 0: Indian STD format (0XXXXXXXXXX)
    if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
        return `+91${digitsOnly.slice(1)}`;
    }
    // 12 digits starting with 91: already has country code
    if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
        return `+${digitsOnly}`;
    }
    // Already has +
    if (formatted.startsWith('+')) {
        return `+${formatted.slice(1).replace(/\D/g, '')}`;
    }
    // Fallback: prepend +91 to last 10 digits
    if (digitsOnly.length >= 10) {
        return `+91${digitsOnly.slice(-10)}`;
    }
    return `+${digitsOnly}`;
}

// Cleanup old sessions every 30 min
setInterval(() => {
    const now = Date.now();
    const TTL = 30 * 60 * 1000;
    for (const key of Object.keys(callUserMap)) {
        if (callUserMap[key]?.timestamp && now - callUserMap[key].timestamp > TTL) {
            delete callUserMap[key];
        }
    }
}, 30 * 60 * 1000);

module.exports = router;
