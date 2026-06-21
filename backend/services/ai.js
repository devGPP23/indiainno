const axios = require('axios');
const FormData = require('form-data');
const Groq = require('groq-sdk');
const dotenv = require('dotenv');

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const SARVAM_API_KEY = process.env.SARVAM_API_KEY;

/**
 * 1. Sarvam AI - Speech to Text (Saaras)
 * Downloads audio from a URL, sends to Sarvam for transcription + translation.
 * Automatically detects Indian language and outputs English transcript.
 */
async function speechToText(audioUrl) {
    try {
        // 1. Download recording audio. 
        // Some providers (like Exotel) might need .wav appended if not present.
        const downloadUrl = (audioUrl && !audioUrl.includes('.')) ? audioUrl + '.wav' : audioUrl;

        console.log(`[Sarvam] Downloading audio from: ${downloadUrl}`);

        // Twilio recordings require Basic Auth (AccountSID:AuthToken)
        const axiosOpts = {
            method: "get",
            url: downloadUrl,
            responseType: "arraybuffer",
            timeout: 30000,
        };
        if (downloadUrl.includes('api.twilio.com') && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
            axiosOpts.auth = {
                username: process.env.TWILIO_ACCOUNT_SID,
                password: process.env.TWILIO_AUTH_TOKEN,
            };
        }
        const response = await axios(axiosOpts);

        // 2. Upload to Sarvam
        const form = new FormData();
        form.append('file', Buffer.from(response.data), {
            filename: 'recording.wav',
            contentType: 'audio/wav'
        });
        form.append('model', 'saaras:v2.5');

        const sarvamRes = await axios.post('https://api.sarvam.ai/speech-to-text-translate', form, {
            headers: {
                ...form.getHeaders(),
                'api-subscription-key': SARVAM_API_KEY,
            },
            timeout: 30000,
        });

        console.log("[Sarvam] STT Output:", sarvamRes.data);
        return {
            transcript: sarvamRes.data.transcript || '',
            language: sarvamRes.data.language_code || 'unknown'
        };

    } catch (err) {
        console.error("[Sarvam STT Error]", err?.response?.data || err.message);
        throw err;
    }
}

/**
 * 1b. Sarvam AI - Speech to Text from Buffer
 * Accepts raw audio buffer for direct processing.
 * Uses speech-to-text (not translate) for better accuracy with all languages.
 */
async function speechToTextFromBuffer(audioBuffer, mimeType = 'audio/webm') {
    try {
        const ext = mimeType.includes('wav') ? 'wav' :
            mimeType.includes('mp3') ? 'mp3' :
                mimeType.includes('ogg') ? 'ogg' : 'webm';

        const form = new FormData();
        form.append('file', audioBuffer, {
            filename: `recording.${ext}`,
            contentType: mimeType
        });
        form.append('model', 'saaras:v3');
        form.append('language_code', 'unknown');

        // Try standard STT first (better for English + Indian languages)
        let sarvamRes;
        try {
            sarvamRes = await axios.post('https://api.sarvam.ai/speech-to-text', form, {
                headers: {
                    ...form.getHeaders(),
                    'api-subscription-key': SARVAM_API_KEY,
                },
                timeout: 30000,
            });
        } catch (sttErr) {
            // Fallback to translate endpoint if standard STT fails
            console.warn('[Sarvam] Standard STT failed, trying translate endpoint:', sttErr?.response?.data || sttErr.message);
            const form2 = new FormData();
            form2.append('file', audioBuffer, {
                filename: `recording.${ext}`,
                contentType: mimeType
            });
            form2.append('model', 'saaras:v2.5');
            sarvamRes = await axios.post('https://api.sarvam.ai/speech-to-text-translate', form2, {
                headers: {
                    ...form2.getHeaders(),
                    'api-subscription-key': SARVAM_API_KEY,
                },
                timeout: 30000,
            });
        }

        console.log("[Sarvam] STT Buffer Output:", sarvamRes.data);
        return {
            transcript: sarvamRes.data.transcript || '',
            language: sarvamRes.data.language_code || 'unknown'
        };
    } catch (err) {
        console.error("[Sarvam STT Buffer Error]", err?.response?.data || err.message);
        throw err;
    }
}

/**
 * 2. Groq LLM - Full MCD complaint classification
 * Takes an English transcript, returns all structured fields needed for a complaint form.
 * This IS the auto-form-fill: Groq extracts everything a citizen would type manually.
 */
async function classifyComplaint(englishTranscript) {
    const prompt = `
You are an AI classifier for CivicSync, an MCD (Municipal Corporation of Delhi) grievance system.
Analyze this citizen complaint and extract ALL structured data as if filling a complaint registration form.

RULES (STRICTLY FOLLOW):
- EVERY field MUST have a non-empty value. NEVER return an empty string for department or primaryCategory.
- If the complaint does not clearly fit a category, use "Other".
- If the department is unclear, pick the closest match. Default to "municipal" if truly ambiguous.
- For scams/fraud/cybercrime → department: "police", primaryCategory: "Safety_Concern"
- For medical issues → department: "health"
- For FIRE related complaints → department: "fire", primaryCategory: "Fire_Hazard" (CRITICAL severity)
- For EMERGENCY/SAFETY issues → Use highest severity level
- Extract location info (zone, ward, locality, pincode) if mentioned.

"department" MUST be exactly ONE of:
pwd, water_supply, municipal, electricity, transport, health, police, fire, environment, education, revenue, social_welfare, food_civil, urban_dev, telecom, forest

"primaryCategory" MUST be exactly ONE of:
Pothole, Road_Damage, Bridge_Issue, Building_Maintenance,
Water_Leak, No_Water, Sewage_Overflow, Drainage_Block,
Garbage, Park_Maintenance, Encroachment, Illegal_Construction,
Streetlight, Power_Outage, Transformer_Issue, Illegal_Wiring,
Traffic_Signal, Bus_Stop_Damage, Missing_Signage, Road_Marking,
Hospital_Issue, Disease_Outbreak, Sanitation_Hazard, Medical_Emergency,
Safety_Concern, Traffic_Violation, Noise_Complaint, Anti_Social,
Fire_Hazard, Building_Safety, Emergency_Access_Block,
Air_Pollution, Water_Pollution, Noise_Pollution, Illegal_Dumping,
School_Infrastructure, Mid_Day_Meal, Teacher_Absence,
Land_Encroachment, Property_Dispute, Missing_Records,
Pension_Issue, Welfare_Scheme, Discrimination_Report,
Ration_Issue, Price_Violation, Food_Adulteration,
Planning_Violation, Housing_Scheme, Building_Permit,
Tower_Issue, Connectivity, Digital_Service,
Tree_Felling, Wildlife_Issue, Forest_Encroachment,
Other

Transcript: "${englishTranscript}"

Respond with ONLY valid JSON (no empty values for required fields):
{
  "primaryCategory": "one from the list above (NEVER empty)",
  "subCategory": "more specific sub-issue in 2-4 words",
  "department": "one from the list above (NEVER empty)",
  "landmark": "location/address mentioned, or empty string if none",
  "zone": "Delhi zone if mentioned (e.g. South Zone, Rohini Zone), or empty string",
  "wardNumber": "ward number if mentioned, or empty string",
  "locality": "locality/area name if mentioned, or empty string",
  "pincode": "pincode if mentioned, or empty string",
  "description": "1-2 sentence English summary of the complaint",
  "severity": "Low or Medium or High or Critical"
}
`;

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama-3.1-8b-instant",
            temperature: 0,
            response_format: { type: "json_object" }
        });

        const jsonRes = JSON.parse(chatCompletion.choices[0].message.content);
        console.log("[Groq] Classification:", jsonRes);
        // Backward compat: also set intentCategory = primaryCategory
        jsonRes.intentCategory = jsonRes.primaryCategory;
        return jsonRes;
    } catch (err) {
        console.error("[Groq Error]", err.message);
        return {
            primaryCategory: "Other",
            intentCategory: "Other",
            subCategory: "",
            department: "municipal",
            landmark: "",
            zone: "",
            wardNumber: "",
            locality: "",
            pincode: "",
            description: englishTranscript,
            severity: "Low"
        };
    }
}

/**
 * Legacy: Entity extraction (backward compatibility)
         */
async function extractComplaintEntities(englishTranscript) {
    const result = await classifyComplaint(englishTranscript);
    return {
        intentCategory: result.intentCategory,
        landmark: result.landmark
    };
}

/**
 * 3. Groq LLM - Extract Scheme Query from Voice Transcript
 * Gets the core intent from a multilingual transcript.
 */
async function extractSchemeQuery(transcript) {
    const prompt = `
You are an AI assistant for a Government Schemes portal.
A citizen has spoken this request (possibly in Hindi, English, or mixed): "${transcript}"

Extract the specific government scheme or topic they are asking about.
Translate the query to a clean English search term.
If they just say general things like "tell me about schemes", return an empty query.

Respond with ONLY valid JSON:
{
  "query": "The core english search term (e.g. 'PM Kisan Pension', 'MP Scholar', 'Mudra Loan')",
  "language": "The original language detected (e.g. 'hi', 'en')"
}
`;
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama-3.1-8b-instant",
            temperature: 0,
            response_format: { type: "json_object" }
        });
        return JSON.parse(chatCompletion.choices[0].message.content);
    } catch (err) {
        console.error("[Groq Extract Scheme Error]", err.message);
        return { query: transcript, language: "unknown" };
    }
}

/**
 * 4. Groq LLM - Generate Scheme Details
 * Generates an overview, deadlines, and a safe link for a given scheme.
 * Used when the PIB RSS feed lacks this detailed info.
 */
async function generateSchemeDetails(schemeName) {
    const prompt = `
You are an expert on Indian Government Schemes.
Provide a concise, highly accurate brief about this scheme: "${schemeName}"

Respond with ONLY valid JSON:
{
  "overview": "A 2-3 sentence simple explanation of the scheme and its benefits.",
  "importantInfo": ["Key eligibility criteria 1", "Key benefit 2", "Required document 3"],
  "deadline": "The typical deadline, or 'Ongoing/No specific deadline', or a specific date if known.",
  "safeLink": "The official .gov.in or .nic.in URL to apply or read more (must be a safe government link)."
}
`;
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama-3.1-8b-instant",
            temperature: 0,
            response_format: { type: "json_object" }
        });
        return JSON.parse(chatCompletion.choices[0].message.content);
    } catch (err) {
        console.error("[Groq Generate Details Error]", err.message);
        return {
            overview: "Information currently unavailable.",
            importantInfo: ["Please check official government sources for eligibility."],
            deadline: "Unknown",
            safeLink: "https://www.india.gov.in"
        };
    }
}

module.exports = {
    speechToText,
    speechToTextFromBuffer,
    classifyComplaint,
    extractComplaintEntities,
    extractSchemeQuery,
    generateSchemeDetails
};
