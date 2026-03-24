const dotenv = require('dotenv');
dotenv.config();

/**
 * TelephonyAdapter — unified provider-agnostic adapter.
 *
 * Auto-detects which telephony provider is configured (Exotel or Twilio)
 * and delegates calls accordingly.
 *
 * Priority: Exotel (if EXOTEL_ACCOUNT_SID is set) → Twilio (if TWILIO_ACCOUNT_SID is set)
 */

function isExotelConfigured() {
    const sid = process.env.EXOTEL_ACCOUNT_SID || '';
    const key = process.env.EXOTEL_API_KEY || '';
    const token = process.env.EXOTEL_API_TOKEN || '';
    const phone = process.env.EXOTEL_PHONE_NUMBER || '';

    return !!(sid && key && token && phone);
}

function isTwilioConfigured() {
    try {
        const { isTwilioConfigured: check } = require('./twilio');
        return check();
    } catch {
        return false;
    }
}

/**
 * Returns the active telephony provider name.
 * @returns {'exotel' | 'twilio' | null}
 */
function getActiveProvider() {
    if (isExotelConfigured()) return 'exotel';
    if (isTwilioConfigured()) return 'twilio';
    return null;
}

/**
 * Check whether any telephony provider is configured.
 */
function isConfigured() {
    return getActiveProvider() !== null;
}

/**
 * Make an outbound call using the active provider.
 * @param {string} phoneNumber — E.164 or 10-digit Indian number
 * @returns {Promise<{ callSid: string, provider: string }>}
 */
async function makeCall(phoneNumber) {
    const provider = getActiveProvider();

    if (!provider) {
        const err = new Error(
            'No telephony provider configured. Set EXOTEL_* or TWILIO_* environment variables.'
        );
        err.code = 'NO_TELEPHONY_PROVIDER';
        throw err;
    }

    if (provider === 'exotel') {
        const exotel = require('./exotel');
        const result = await exotel.makeCall(phoneNumber);
        return { ...result, provider: 'exotel' };
    }

    // Twilio
    const twilio = require('./twilio');
    const result = await twilio.makeCall(phoneNumber);
    return { ...result, provider: 'twilio' };
}

/**
 * Get the configured helpline phone number.
 */
function getHelplineNumber() {
    const provider = getActiveProvider();
    if (provider === 'exotel') return process.env.EXOTEL_PHONE_NUMBER || 'Not Configured';
    if (provider === 'twilio') return process.env.TWILIO_PHONE_NUMBER || 'Not Configured';
    return 'Not Configured';
}

module.exports = {
    getActiveProvider,
    isConfigured,
    isExotelConfigured,
    isTwilioConfigured,
    makeCall,
    getHelplineNumber
};
