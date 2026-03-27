import { createContext, useContext, useState, useEffect } from 'react';

const LanguageContext = createContext();

export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिंदी', flag: '🇮🇳' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', flag: '🇧🇩' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', flag: '🇮🇳' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', flag: '🇮🇳' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', flag: '🇮🇳' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', flag: '🇵🇰' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', flag: '🇮🇳' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', flag: '🇮🇳' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', flag: '🇮🇳' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', flag: '🇮🇳' },
  { code: 'as', name: 'Assamese', nativeName: 'অসমীয়া', flag: '🇮🇳' },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', flag: '🇮🇳' },
  { code: 'sa', name: 'Sanskrit', nativeName: 'संस्कृतं', flag: '🇮🇳' },
  { code: 'kok', name: 'Konkani', nativeName: 'कोंकणी', flag: '🇮🇳' },
  { code: 'mni', name: 'Manipuri', nativeName: 'মৈতৈলো', flag: '🇮🇳' },
  { code: 'doi', name: 'Dogri', nativeName: 'डोगरी', flag: '🇮🇳' },
  { code: 'snd', name: 'Sindhi', nativeName: 'सिंधी', flag: '🇵🇰' },
];

const TRANSLATION_CACHE_KEY = 'civicsync_translation_cache';
const SELECTED_LANGUAGE_KEY = 'civicsync_selected_language';

function getCache() {
  try {
    const cached = localStorage.getItem(TRANSLATION_CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
}

function setCache(cache) {
  try {
    localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

export function LanguageProvider({ children }) {
  const [currentLanguage, setCurrentLanguage] = useState('en');
  const [translations, setTranslations] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(SELECTED_LANGUAGE_KEY);
    if (saved && LANGUAGES.find(l => l.code === saved)) {
      setCurrentLanguage(saved);
    }
  }, []);

  const translateText = async (text, targetLang) => {
    if (!text || targetLang === 'en') return text;
    if (!text.trim()) return text;

    const cache = getCache();
    const cacheKey = `${targetLang}:${text.substring(0, 50)}`;
    
    if (cache[cacheKey]) {
      return cache[cacheKey];
    }

    try {
      const response = await fetch('https://api.sarvam.ai/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-subscription-key': 'ede9b8b1-033f-4158-8f11-0ed00d6096f4'
        },
        body: JSON.stringify({
          input: text,
          source_language: 'en-IN',
          target_language: targetLang === 'hi' ? 'hi' : targetLang,
          output_script: 'Devanagari'
        })
      });

      if (!response.ok) throw new Error('Translation failed');

      const data = await response.json();
      const translatedText = data[0]?.translated_text || text;

      cache[cacheKey] = translatedText;
      setCache(cache);

      return translatedText;
    } catch (err) {
      console.warn('Translation failed:', err.message);
      return text;
    }
  };

  const translateBatch = async (texts, targetLang) => {
    if (targetLang === 'en') return texts;
    return Promise.all(texts.map(t => translateText(t, targetLang)));
  };

  const changeLanguage = async (langCode) => {
    setIsLoading(true);
    setCurrentLanguage(langCode);
    localStorage.setItem(SELECTED_LANGUAGE_KEY, langCode);
    
    if (langCode !== 'en') {
      document.documentElement.dir = langCode === 'ur' ? 'rtl' : 'ltr';
    } else {
      document.documentElement.dir = 'ltr';
    }
    
    setIsLoading(false);
  };

  const t = (text) => {
    if (currentLanguage === 'en' || !text) return text;
    return translations[text] || text;
  };

  const value = {
    currentLanguage,
    changeLanguage,
    translateText,
    translateBatch,
    t,
    isLoading,
    showLanguageModal,
    setShowLanguageModal,
    languages: LANGUAGES
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}

export default LanguageContext;
