const axios = require('axios');
const Groq = require('groq-sdk');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const FormData = require('form-data');
const dotenv = require('dotenv');

dotenv.config();

// ── Config ──
const EXOTEL_API_KEY = process.env.EXOTEL_API_KEY;
const EXOTEL_API_TOKEN = process.env.EXOTEL_API_TOKEN;
const EXOTEL_ACCOUNT_SID = process.env.EXOTEL_ACCOUNT_SID || process.env.EXOTEL_SID;
const EXOTEL_SUBDOMAIN = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';
const EXOTEL_PHONE_NUMBER = process.env.EXOTEL_PHONE_NUMBER;
const WEBHOOK_BASE_URL = (process.env.WEBHOOK_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
const PUBLIC_ASSET_PATH = process.env.PUBLIC_ASSET_PATH || 'public/responses';
const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

const DIGITAL_DEMOCRACY_SYSTEM_PROMPT = process.env.DIGITAL_DEMOCRACY_SYSTEM_PROMPT ||
    'You are Digital Democracy, a civic grievance AI assistant for India. Provide clear, practical, empathetic responses for citizen complaints and civic issues.';

// ── Exotel HTTP client ──
const exotelClient = axios.create({
    baseURL: `https://${EXOTEL_SUBDOMAIN}/v1/Accounts/${EXOTEL_ACCOUNT_SID}`,
    auth: {
        username: EXOTEL_API_KEY || '',
        password: EXOTEL_API_TOKEN || ''
    },
    timeout: 30000
});

// ── Phone number helpers ──
function normalizeIndianNumber(value) {
    const raw = String(value || '').trim();
    const digits = raw.replace(/\D/g, '');

    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    if (digits.length === 13 && digits.startsWith('0')) return `+${digits.slice(1)}`;
    if (raw.startsWith('+') && digits.length >= 10) return `+${digits}`;
    return raw;
}

// ── Config validation ──
function assertExotelConfig() {
    const missing = [];
    if (!EXOTEL_ACCOUNT_SID) missing.push('EXOTEL_ACCOUNT_SID');
    if (!EXOTEL_API_KEY) missing.push('EXOTEL_API_KEY');
    if (!EXOTEL_API_TOKEN) missing.push('EXOTEL_API_TOKEN');
    if (!EXOTEL_PHONE_NUMBER) missing.push('EXOTEL_PHONE_NUMBER');

    if (missing.length) {
        const err = new Error(`Missing Exotel config: ${missing.join(', ')}`);
        err.code = 'EXOTEL_CONFIG_MISSING';
        throw err;
    }
}

// ══════════════════════════════════════════════════════════════
// CALL MANAGEMENT
// ══════════════════════════════════════════════════════════════

/**
 * Make an outbound call via Exotel Connect API.
 */
async function makeCall(citizenPhone) {
    assertExotelConfig();

    const from = normalizeIndianNumber(citizenPhone);
    const exotelNumber = normalizeIndianNumber(EXOTEL_PHONE_NUMBER);
    const to = normalizeIndianNumber(process.env.EXOTEL_DESTINATION_NUMBER || EXOTEL_PHONE_NUMBER);

    const appletUrl = process.env.EXOTEL_APPLET_URL || `${WEBHOOK_BASE_URL}/api/voice/incoming`;
    const statusCallbackUrl = process.env.EXOTEL_STATUS_CALLBACK_URL || `${WEBHOOK_BASE_URL}/api/voice/call-status`;

    const payload = {
        From: from,
        To: to,
        CallerId: exotelNumber,
        CallType: 'trans',
        TimeLimit: 900,
        TimeOut: 30,
        Url: appletUrl,
        StatusCallback: statusCallbackUrl,
        StatusCallbackContentType: 'application/json',
    };

    console.log(`[Exotel] Making call: From=${from}, To=${to}, CallerId=${exotelNumber}`);

    try {
        const url = `https://${EXOTEL_SUBDOMAIN}/v1/Accounts/${EXOTEL_ACCOUNT_SID}/Calls/connect.json`;
        const body = new URLSearchParams(payload).toString();

        const { data } = await axios.post(url, body, {
            auth: { username: EXOTEL_API_KEY, password: EXOTEL_API_TOKEN },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 20000,
        });

        const callSid = data?.Call?.Sid || data?.Call?.sid || data?.sid || null;
        console.log(`[Exotel] Call initiated: ${callSid}`);
        return { callSid, providerResponse: data };
    } catch (error) {
        if (error.response) {
            const providerData = error.response.data;
            const providerMessage = providerData?.message || providerData?.Message || JSON.stringify(providerData);
            console.error(`[Exotel] API Error (${error.response.status}):`, providerMessage);
            const wrapped = new Error(providerMessage || 'Exotel API request failed');
            wrapped.code = error.response.status === 401 ? 'EXOTEL_AUTH_FAILED' : 'EXOTEL_API_ERROR';
            wrapped.providerStatus = error.response.status;
            wrapped.providerData = providerData;
            throw wrapped;
        }

        const wrapped = new Error(error.message || 'Exotel request failed');
        wrapped.code = 'EXOTEL_NETWORK_ERROR';
        throw wrapped;
    }
}

/**
 * Initiate an outbound call (alternate form used by /initiate-call route).
 * Uses the exotelClient axios instance.
 */
async function initiateCall(userPhoneNumber) {
    assertExotelConfig();

    const toNumber = normalizeIndianNumber(userPhoneNumber);
    if (!toNumber) throw new Error('Invalid user phone number');
    if (!WEBHOOK_BASE_URL) throw new Error('Missing WEBHOOK_BASE_URL');

    const callbackUrl = `${WEBHOOK_BASE_URL}/incoming-handler`;
    const formBody = new URLSearchParams({
        From: EXOTEL_PHONE_NUMBER,
        To: toNumber,
        CallerId: EXOTEL_PHONE_NUMBER,
        Url: callbackUrl,
        CallType: 'trans'
    });

    const response = await exotelClient.post('/Calls/connect.json', formBody.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000
    });

    const sid = response.data?.Call?.Sid || response.data?.Call?.sid || response.data?.sid || null;
    return {
        sid,
        to: toNumber,
        from: EXOTEL_PHONE_NUMBER,
        url: callbackUrl,
        raw: response.data
    };
}

/**
 * Fetch call details from Exotel.
 */
async function getCallDetails(callSid) {
    if (!callSid) throw new Error('Missing callSid');
    const response = await exotelClient.get(`/Calls/${callSid}.json`);
    const callData = response.data?.Call || response.data;
    return {
        sid: callData.Sid || callData.sid,
        status: callData.Status || callData.status,
        recordingUrl: callData.RecordingUrl || callData.recording_url || callData.RecordingURL || null,
        from: callData.From || callData.from,
        to: callData.To || callData.to,
        duration: callData.Duration || callData.duration,
        raw: callData
    };
}

/**
 * Poll Exotel until recording URL is available.
 */
async function pollForRecording(callSid, { maxAttempts = 10, delayMs = 30000 } = {}) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`   🔄 Polling attempt ${attempt}/${maxAttempts} for CallSid ${callSid}...`);
        try {
            const details = await getCallDetails(callSid);
            console.log(`   Status: ${details.status}, RecordingUrl: ${details.recordingUrl || '(not yet)'}`);

            if (details.recordingUrl) {
                console.log(`   ✅ Recording URL found on attempt ${attempt}`);
                return details;
            }

            const status = (details.status || '').toLowerCase();
            if (['completed', 'failed', 'busy', 'no-answer'].includes(status) && attempt >= maxAttempts) {
                console.log(`   ⚠️ Call ended (${status}) but no recording URL after ${maxAttempts} attempts`);
                return details;
            }
        } catch (err) {
            console.error(`   ⚠️ Poll attempt ${attempt} failed:`, err.message);
        }

        if (attempt < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    return null;
}

// ══════════════════════════════════════════════════════════════
// AI PIPELINE (STT → Classification → TTS)
// ══════════════════════════════════════════════════════════════

async function downloadRecordingAsBuffer(recordingUrl) {
    const response = await axios.get(recordingUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        auth: { username: EXOTEL_API_KEY || '', password: EXOTEL_API_TOKEN || '' }
    });
    return Buffer.from(response.data);
}

/**
 * Transcribe a recording URL via Sarvam STT.
 */
async function transcribeRecordingUrl(recordingUrl) {
    if (!SARVAM_API_KEY) throw new Error('Missing SARVAM_API_KEY');

    const recordingBuffer = await downloadRecordingAsBuffer(recordingUrl);

    const form = new FormData();
    form.append('file', recordingBuffer, { filename: 'recording.wav', contentType: 'audio/wav' });
    form.append('model', 'saaras:v1');

    const sttResponse = await axios.post('https://api.sarvam.ai/speech-to-text-translate', form, {
        headers: { ...form.getHeaders(), 'api-subscription-key': SARVAM_API_KEY },
        timeout: 120000
    });

    return sttResponse.data?.transcript || '';
}

// Classification prompt
const CLASSIFY_SYSTEM_PROMPT = `You are a civic complaint classifier for India.
Given a citizen's voice complaint transcript, extract:
1. category — one of: Road_Damage, Water_Supply, Drainage_Sewage, Garbage_Waste, Street_Light, Traffic, Noise_Pollution, Encroachment, Public_Safety, Other
2. department — the government department responsible (e.g., PWD, Water Board, BBMP, Traffic Police, Electricity Board, Municipal Corporation, Health Department, or null if unclear)
3. description — a clean, one-line English summary of the complaint
4. landmark — any location/landmark mentioned, or empty string

Respond ONLY with valid JSON: {"category":"...","department":"...","description":"...","landmark":""}`;

/**
 * Process an inbound voicemail recording end-to-end:
 * 1. Download + Transcribe via Sarvam STT
 * 2. Classify via Groq AI → category, department, description
 * 3. Save as MasterTicket + RawComplaint in MongoDB
 */
async function processInboundRecording(recordingUrl, callerPhone) {
    // Lazy-require models to avoid circular dependencies at module load
    const { MasterTicket, RawComplaint } = require('../models/Ticket');

    console.log(`\n🎙️ [processInboundRecording] Starting for ${callerPhone}`);
    console.log(`   RecordingUrl: ${recordingUrl}`);

    // Step 1: Transcribe
    let transcript = '';
    try {
        transcript = await transcribeRecordingUrl(recordingUrl);
        console.log(`   ✅ Transcript: "${transcript}"`);
    } catch (err) {
        console.error('   ❌ STT failed:', err.message);
        transcript = '[Transcription failed]';
    }

    // Step 2: Classify via AI
    let category = 'Other';
    let department = null;
    let description = transcript;
    let landmark = '';

    if (groq) {
        try {
            const classifyResult = await groq.chat.completions.create({
                model: 'llama-3.1-8b-instant',
                temperature: 0.1,
                messages: [
                    { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
                    { role: 'user', content: transcript || 'Empty recording — no speech detected' }
                ]
            });

            const raw = classifyResult.choices?.[0]?.message?.content?.trim() || '{}';
            console.log(`   AI raw response: ${raw}`);

            const jsonStr = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
            const parsed = JSON.parse(jsonStr);
            category = parsed.category || 'Other';
            department = parsed.department || null;
            description = parsed.description || transcript;
            landmark = parsed.landmark || '';
            console.log(`   ✅ Classified: category=${category}, department=${department}`);
        } catch (err) {
            console.error('   ⚠️ Classification failed, defaulting to Other:', err.message);
        }
    }

    // Step 3: Save ticket
    try {
        const masterTicket = new MasterTicket({
            intentCategory: category,
            description: description,
            severity: 'Low',
            complaintCount: 1,
            status: 'Open',
            department: department,
            needsManualGeo: true,
            landmark: landmark,
            audioUrl: recordingUrl,
            source: 'voice_call'
        });
        await masterTicket.save();
        console.log(`   ✅ MasterTicket saved: ${masterTicket.ticketNumber} (${masterTicket._id})`);

        const rawComplaint = new RawComplaint({
            callerPhone: callerPhone,
            callerPhoneRaw: callerPhone,
            audioUrl: recordingUrl,
            transcriptOriginal: transcript,
            transcriptEnglish: description,
            intentCategory: category,
            extractedLandmark: landmark,
            department: department,
            source: 'voice_call',
            status: 'Open',
            masterTicketId: masterTicket._id
        });
        await rawComplaint.save();
        console.log(`   ✅ RawComplaint saved: ${rawComplaint._id}`);

        return {
            success: true,
            ticketNumber: masterTicket.ticketNumber,
            ticketId: masterTicket._id,
            category,
            description
        };
    } catch (err) {
        console.error('   ❌ Failed to save ticket:', err.message);
        throw err;
    }
}

/**
 * Get a Digital Democracy AI reply for a user's text.
 */
async function getDigitalDemocracyReply(userText) {
    if (!groq) throw new Error('Missing GROQ_API_KEY');

    const completion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        temperature: 0.3,
        messages: [
            { role: 'system', content: DIGITAL_DEMOCRACY_SYSTEM_PROMPT },
            { role: 'user', content: userText }
        ]
    });

    let reply = completion.choices?.[0]?.message?.content?.trim() || 'Thank you for reporting this issue. Your complaint has been recorded.';
    if (reply.length > 500) reply = reply.substring(0, 497) + '...';
    return reply;
}

// ══════════════════════════════════════════════════════════════
// TEXT-TO-SPEECH & AUDIO
// ══════════════════════════════════════════════════════════════

function normalizeSarvamAudio(responseData) {
    if (!responseData) return null;
    const maybeBase64 =
        responseData.audio ||
        responseData.audio_data ||
        responseData.audioContent ||
        responseData.audios?.[0]?.audio;
    if (maybeBase64) return Buffer.from(maybeBase64, 'base64');
    return null;
}

async function synthesizeSpeech(text) {
    if (!SARVAM_API_KEY) throw new Error('Missing SARVAM_API_KEY');

    const payload = {
        text,
        target_language_code: 'en-IN',
        speaker: 'anushka',
        pitch: 0,
        pace: 1,
        loudness: 1,
        speech_sample_rate: 22050,
        enable_preprocessing: true,
        model: 'bulbul:v1'
    };

    try {
        const ttsJsonResponse = await axios.post('https://api.sarvam.ai/text-to-speech', payload, {
            headers: { 'Content-Type': 'application/json', 'api-subscription-key': SARVAM_API_KEY },
            timeout: 120000
        });
        const jsonAudioBuffer = normalizeSarvamAudio(ttsJsonResponse.data);
        if (jsonAudioBuffer) return { buffer: jsonAudioBuffer, extension: 'mp3' };
    } catch (jsonErr) {
        console.warn('[Sarvam TTS] JSON mode failed, retrying in binary mode:', jsonErr.message);
    }

    const ttsBinaryResponse = await axios.post('https://api.sarvam.ai/text-to-speech', payload, {
        headers: { 'Content-Type': 'application/json', 'api-subscription-key': SARVAM_API_KEY, Accept: 'audio/mpeg' },
        responseType: 'arraybuffer',
        timeout: 120000
    });

    return { buffer: Buffer.from(ttsBinaryResponse.data), extension: 'mp3' };
}

async function saveResponseAudio(buffer, extension = 'mp3') {
    const normalizedAssetPath = PUBLIC_ASSET_PATH.replace(/^\/+/, '').replace(/\\/g, '/').replace(/\/+$/, '');
    const responsesDir = path.join(__dirname, '..', ...normalizedAssetPath.split('/'));
    await fs.mkdir(responsesDir, { recursive: true });

    const fileName = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const absoluteFilePath = path.join(responsesDir, fileName);
    await fs.writeFile(absoluteFilePath, buffer);

    const baseUrl = WEBHOOK_BASE_URL.replace(/\/+$/, '');
    const audioUrl = `${baseUrl}/${normalizedAssetPath}/${fileName}`;
    console.log('[saveResponseAudio] File saved to:', absoluteFilePath);
    console.log('[saveResponseAudio] Public URL:', audioUrl);
    return audioUrl;
}

function escapeXml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// ══════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════

module.exports = {
    // Call management
    makeCall,
    initiateCall,
    getCallDetails,
    pollForRecording,

    // AI pipeline
    processInboundRecording,
    transcribeRecordingUrl,
    getDigitalDemocracyReply,
    synthesizeSpeech,
    saveResponseAudio,

    // Utilities
    normalizeIndianNumber,
    escapeXml,
    exotelClient,
    assertExotelConfig
};
