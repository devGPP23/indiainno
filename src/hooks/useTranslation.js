import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

const SARVAM_API_KEY = import.meta.env.VITE_SARVAM_API_KEY || 'sk_94vvqhgo_opzIH8VOZKtoPs894jfnFGAZ';

const translationCache = new Map();

export function useTranslation() {
  const { currentLanguage, changeLanguage, isTranslating, languages } = useLanguage();
  
  const translate = useCallback(async (text) => {
    if (!text || currentLanguage === 'en-IN' || !text.trim()) return text;
    
    const cacheKey = `${currentLanguage}:${text.substring(0, 100)}`;
    if (translationCache.has(cacheKey)) {
      return translationCache.get(cacheKey);
    }

    try {
      const response = await fetch('https://api.sarvam.ai/text/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-subscription-key': SARVAM_API_KEY
        },
        body: JSON.stringify({
          input: text,
          source_language_code: 'en-IN',
          target_language_code: currentLanguage,
          speaker_gender: 'Male'
        })
      });

      if (!response.ok) throw new Error('Translation failed');

      const data = await response.json();
      const translatedText = data.translated_text || text;
      translationCache.set(cacheKey, translatedText);
      
      // Limit cache size
      if (translationCache.size > 1000) {
        const firstKey = translationCache.keys().next().value;
        translationCache.delete(firstKey);
      }
      
      return translatedText;
    } catch (err) {
      console.warn('Translation error:', err.message);
      return text;
    }
  }, [currentLanguage]);

  const translateElement = useCallback((element) => {
    if (currentLanguage === 'en-IN' || !element) return element;
    
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent.trim() && !node.parentElement.matches('script, style, textarea, input, [data-no-translate]')) {
        textNodes.push(node);
      }
    }

    return textNodes;
  }, [currentLanguage]);

  return {
    t: translate,
    currentLanguage,
    changeLanguage,
    isTranslating,
    languages,
    translateElement
  };
}

export default useTranslation;
