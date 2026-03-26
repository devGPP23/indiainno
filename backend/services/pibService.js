const axios = require('axios');
const xml2js = require('xml2js');

// In-memory cache
let cache = {
    data: null,
    timestamp: null,
    TTL: 60 * 60 * 1000 // 1 hour
};

// PIB RSS Feed URL (main feed - all ministries)
const PIB_RSS_URL = 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3';

// Sector keyword mapping — use multi-word phrases and scheme names for precision.
// Short English words (<=4 chars) use word-boundary matching to avoid false positives.
const SECTOR_KEYWORDS = {
    farming: [
        // English
        'agriculture', 'farmer', 'kisan', 'pm-kisan', 'pm kisan', 'crop insurance',
        'farming', 'fasal bima', 'irrigation', 'soil health', 'fertilizer', 'fertiliser',
        'fisheries', 'animal husbandry', 'dairy development', 'horticulture',
        'agri-business', 'agri business', 'agricultural', 'crop', 'millet',
        'food grain', 'food processing', 'minimum support price', 'msp',
        'paramparagat krishi', 'krishi', 'e-nam', 'soil card',
        // Hindi
        'कृषि', 'किसान', 'फसल', 'सिंचाई', 'पशुपालन', 'मत्स्यपालन', 'मत्स्य',
        'उर्वरक', 'बागवानी', 'कृषक', 'खाद्य', 'दुग्ध', 'पशु', 'मंडी',
        'कृषि मंत्रालय', 'खेती', 'किसानों'
    ],
    education: [
        // English
        'education', 'scholarship', 'school', 'college', 'university', 'student',
        'skill development', 'apprenticeship', 'mid day meal', 'midday meal',
        'diksha', 'nyps', 'samagra shiksha', 'nep', 'national education policy',
        'digital education', 'higher education', 'literacy', 'iit', 'iim',
        'ugc', 'aicte', 'cbse', 'atal innovation', 'academic', 'vocational training',
        // Hindi
        'शिक्षा', 'छात्र', 'विद्यालय', 'विश्वविद्यालय', 'कौशल', 'छात्रवृत्ति',
        'महाविद्यालय', 'शैक्षणिक', 'प्रशिक्षण', 'एनवाईपीएस', 'शिक्षण',
        'पाठ्यक्रम', 'विद्यार्थी', 'शिक्षक', 'स्कूल', 'कॉलेज'
    ],
    financial: [
        // English
        'jan dhan', 'mudra loan', 'mudra yojana', 'finance minister', 'finance ministry',
        'banking', 'loan waiver', 'insurance scheme', 'msme', 'startup india',
        'credit guarantee', 'subsidy', 'income tax', 'gst council',
        'budget session', 'fiscal', 'monetary policy', 'rbi', 'reserve bank',
        'financial inclusion', 'digital payment', 'upi', 'rupay',
        'public sector bank', 'nbfc', 'sebi', 'stock exchange',
        // Hindi
        'वित्त', 'बैंक', 'ऋण', 'बीमा', 'सब्सिडी', 'जन धन', 'मुद्रा',
        'आर्थिक', 'वित्तीय', 'बजट', 'निवेश', 'व्यापार', 'उद्योग',
        'वित्त मंत्रालय', 'वित्त मंत्री', 'कर', 'जीएसटी', 'रुपये',
        'आयकर', 'वाणिज्य', 'एमएसएमई', 'करोड़', 'बैंकिंग'
    ],
    development: [
        // English
        'infrastructure', 'housing for all', 'smart city', 'smart cities',
        'urban development', 'rural development', 'highway construction',
        'railway project', 'road construction', 'swachh bharat', 'jal jeevan',
        'amrut', 'pmay', 'pradhan mantri awas', 'metro rail', 'expressway',
        'bharatmala', 'sagarmala', 'port development', 'power sector',
        'renewable energy', 'solar energy', 'green hydrogen', 'electric vehicle',
        'national highway', 'road transport', 'kavach', 'signalling',
        // Hindi
        'विकास', 'ग्रामीण', 'बुनियादी ढांचा', 'आवास', 'सड़क', 'रेलवे', 'रेल',
        'राजमार्ग', 'निर्माण', 'स्वच्छ', 'जल जीवन', 'ऊर्जा', 'परिवहन',
        'हाईवे', 'प्रिज्म', 'आरओबी', 'पुल', 'मेट्रो', 'कवच',
        'मार्ग', 'रेल मंत्रालय', 'पोर्ट', 'विद्युत', 'सौर'
    ],
    health: [
        // English
        'health ministry', 'ayushman bharat', 'hospital', 'medical college',
        'vaccination', 'vaccine drive', 'nutrition mission', 'poshan',
        'sanitation', 'wellness centre', 'national health', 'nhm', 'nrhm',
        'pharmaceutical', 'drug control', 'medical device', 'pmjay',
        'jan aushadhi', 'health insurance', 'ayush', 'ayurveda', 'yoga',
        'mental health', 'pandemic', 'epidemic', 'tuberculosis', 'malaria',
        // Hindi
        'स्वास्थ्य', 'अस्पताल', 'चिकित्सा', 'दवा', 'टीका', 'पोषण', 'आयुष',
        'आयुर्वेद', 'स्टेंट', 'औषधि', 'रोगी', 'उपचार', 'चिकित्सक',
        'स्वास्थ्य मंत्रालय', 'टीकाकरण', 'रसायन', 'जन औषधि',
        'स्वास्थ्य सेवा', 'चिकित्सालय'
    ],
    women: [
        // English
        'women empowerment', 'mahila', 'beti bachao', 'beti padhao',
        'maternity benefit', 'self help group', 'ujjwala yojana', 'ujjwala',
        'gender equality', 'girl child', 'women and child',
        'one stop centre', 'sakhi', 'nari shakti', 'working women',
        'women safety', 'protection of women', 'dowry', 'domestic violence',
        'anganwadi', 'icds', 'poshan abhiyaan',
        // Hindi
        'महिला', 'बेटी', 'मातृत्व', 'स्वयं सहायता', 'सशक्तिकरण',
        'महिलाओं', 'बालिका', 'नारी', 'आंगनवाड़ी', 'नारी शक्ति',
        'महिला एवं बाल', 'महिला सशक्तिकरण', 'बाल विकास',
        'बाल कल्याण', 'स्त्री'
    ]
};

// Helper: check if text matches a keyword.
// For short English keywords (<=4 chars), use word-boundary matching to avoid false positives.
function textMatchesKeyword(text, keyword) {
    const kw = keyword.toLowerCase();
    // For short English-only keywords, use word boundary regex
    if (kw.length <= 4 && /^[a-z]+$/.test(kw)) {
        const regex = new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        return regex.test(text);
    }
    return text.includes(kw);
}

// Fetch and parse PIB RSS
async function fetchPIBFeed() {
    const response = await axios.get(PIB_RSS_URL, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IndiaSchemes/1.0)' }
    });

    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(response.data);
    const items = result.rss.channel.item;

    if (!items) return [];
    const itemList = Array.isArray(items) ? items : [items];

    return itemList.map(item => ({
        title: item.title || '',
        link: item.link || '',
        description: item.description || item.title || '',
        pubDate: item.pubDate || new Date().toISOString()
    }));
}

// Get all feed items (with cache)
async function getAllSchemes() {
    const now = Date.now();
    if (cache.data && cache.timestamp && (now - cache.timestamp) < cache.TTL) {
        return cache.data;
    }

    const items = await fetchPIBFeed();
    cache.data = items;
    cache.timestamp = now;
    return items;
}

// Filter schemes by sector using keywords
async function getSchemesBySector(sector) {
    const allItems = await getAllSchemes();
    const keywords = SECTOR_KEYWORDS[sector] || [];

    if (!keywords.length) return allItems;

    return allItems.filter(item => {
        const text = (item.title + ' ' + item.description).toLowerCase();
        return keywords.some(kw => textMatchesKeyword(text, kw));
    });
}

// Get all schemes organized by sector
async function getAllSectorSchemes() {
    const allItems = await getAllSchemes();
    const result = {};

    for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
        result[sector] = allItems.filter(item => {
            const text = (item.title + ' ' + item.description).toLowerCase();
            return keywords.some(kw => textMatchesKeyword(text, kw));
        });

        // No fallback — if no matches, the sector shows 0 results honestly.
        // This ensures only relevant news appears under each sector card.
    }

    // Also include "all" bucket — recent 20 items
    result['all'] = allItems.slice(0, 20);

    return result;
}

module.exports = { getSchemesBySector, getAllSectorSchemes, getAllSchemes };
