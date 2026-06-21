import { useState, useEffect, useRef } from 'react';
import { HiMicrophone, HiGlobe, HiTranslate } from 'react-icons/hi';
import { LANGUAGES } from '../contexts/LanguageContext';
import { processVoiceCommand, startRecording, stopRecording, transcribeWithSarvam, interpretCommandWithGroq, executeCommand } from '../services/voiceAssistant';

const SARVAM_API_KEY = import.meta.env.VITE_SARVAM_API_KEY || 'sk_94vvqhgo_opzIH8VOZKtoPs894jfnFGAZ';

export default function VoiceAssistant() {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [selectedLang, setSelectedLang] = useState('en-IN');
  const [status, setStatus] = useState('idle');
  const [lastResult, setLastResult] = useState(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedCount, setTranslatedCount] = useState(0);

  // Translate entire page when language changes
  const translatePage = async (targetLang) => {
    if (targetLang === 'en-IN') return;
    
    setIsTranslating(true);
    setStatus('translating');
    
    const textElements = [];
    
    // Collect all translatable elements
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const text = node.textContent?.trim();
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') return NodeFilter.FILTER_REJECT;
          if (parent.tagName === 'TEXTAREA' || parent.tagName === 'INPUT') return NodeFilter.FILTER_REJECT;
          if (parent.dataset?.noTranslate === 'true') return NodeFilter.FILTER_REJECT;
          if (text && text.length > 1 && text.length < 200 && !text.match(/^[0-9\W]+$/)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      textElements.push({
        element: node,
        originalText: node.textContent.trim()
      });
    }

    // Remove duplicates
    const uniqueTexts = [...new Map(textElements.map(t => [t.originalText, t])).values()];

    let translated = 0;
    
    for (const item of uniqueTexts) {
      if (item.originalText.length < 2) continue;
      
      try {
        const response = await fetch('https://api.sarvam.ai/text/translate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-subscription-key': SARVAM_API_KEY
          },
          body: JSON.stringify({
            input: item.originalText,
            source_language_code: 'en-IN',
            target_language_code: targetLang,
            speaker_gender: 'Male'
          })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.translated_text && data.translated_text !== item.originalText) {
            item.element.parentElement.dataset.translated = 'true';
            item.element.parentElement.dataset.original = item.originalText;
            item.element.textContent = data.translated_text;
            translated++;
          }
        }
      } catch (err) {
        console.warn('Translation error:', err);
      }
    }

    setTranslatedCount(translated);
    setIsTranslating(false);
    setStatus('idle');
    
    // Store original texts for reverting
    document.body.dataset.currentLang = targetLang;
  };

  // Handle language selection
  const handleLanguageSelect = async (langCode) => {
    setShowLangMenu(false);
    setSelectedLang(langCode);
    
    if (langCode === 'en-IN') {
      // Revert to English
      const translatedElements = document.querySelectorAll('[data-translated="true"]');
      translatedElements.forEach(el => {
        el.textContent = el.dataset.original || el.textContent;
        el.dataset.translated = 'false';
      });
      setTranslatedCount(0);
      return;
    }
    
    await translatePage(langCode);
  };

  // Handle voice command
  const handleVoiceCommand = async () => {
    if (isListening || isProcessing) return;

    setIsListening(true);
    setStatus('listening');
    
    const startResult = await startRecording();
    if (!startResult.success) {
      setIsListening(false);
      setStatus('error');
      setLastResult({ success: false, message: 'Mic error' });
      setTimeout(() => setStatus('idle'), 2000);
      return;
    }

    // Wait for speech
    setStatus('speak');
    await new Promise(r => setTimeout(r, 4000));

    setStatus('processing');
    const stopResult = await stopRecording();
    
    if (!stopResult.success || !stopResult.audio) {
      setIsListening(false);
      setStatus('error');
      return;
    }

    // Transcribe
    setStatus('transcribing');
    const transcriptResult = await transcribeWithSarvam(stopResult.audio);
    
    if (!transcriptResult.success || !transcriptResult.text) {
      setIsListening(false);
      setStatus('error');
      setLastResult({ success: false, message: 'No speech detected' });
      setTimeout(() => setStatus('idle'), 2000);
      return;
    }

    // Interpret with Groq
    setStatus('interpreting');
    const command = await interpretCommandWithGroq(transcriptResult.text);

    // Execute
    setStatus('executing');
    const execResult = await executeCommand(command);

    setLastResult({
      success: execResult.success,
      transcribed: transcriptResult.text,
      command,
      execution: execResult
    });
    
    setIsListening(false);
    setStatus(execResult.success ? 'success' : 'error');
    setTimeout(() => setStatus('idle'), 3000);
  };

  const getStatusColor = () => {
    switch (status) {
      case 'listening': case 'speak': return '#ef4444';
      case 'translating': case 'transcribing': case 'interpreting': case 'executing': return '#3b82f6';
      case 'success': return '#22c55e';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const currentLangData = LANGUAGES.find(l => l.code === selectedLang) || LANGUAGES[0];

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 20,
          left: 20,
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        {/* Language Selector */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowLangMenu(!showLangMenu)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              background: selectedLang !== 'en-IN' ? '#22c55e' : '#1e293b',
              color: '#fff',
              border: 'none',
              borderRadius: 25,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
            }}
          >
            <HiGlobe style={{ fontSize: 18 }} />
            <span>{currentLangData.flag}</span>
            <span style={{ maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentLangData.nativeName}
            </span>
            {isTranslating && (
              <span style={{ animation: 'spin 1s linear infinite' }}>...</span>
            )}
          </button>

          {showLangMenu && (
            <>
              <div 
                style={{ position: 'fixed', inset: 0, zIndex: 99998 }} 
                onClick={() => setShowLangMenu(false)}
              />
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 8,
                background: '#fff',
                borderRadius: 12,
                boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                maxHeight: 400,
                overflow: 'auto',
                minWidth: 200,
                zIndex: 99999
              }}>
                {LANGUAGES.map(lang => (
                  <button
                    key={lang.code}
                    onClick={() => handleLanguageSelect(lang.code)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      padding: '12px 16px',
                      background: selectedLang === lang.code ? '#f1f5f9' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: 13,
                      color: '#1e293b'
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{lang.flag}</span>
                    <span style={{ flex: 1 }}>{lang.nativeName}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{lang.name}</span>
                    {selectedLang === lang.code && (
                      <span style={{ color: '#22c55e', fontWeight: 600 }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Voice Button */}
        <button
          onClick={handleVoiceCommand}
          disabled={isListening || isProcessing || isTranslating}
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: getStatusColor(),
            border: '3px solid #fff',
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: isListening || isProcessing || isTranslating ? 'wait' : 'pointer',
            transition: 'all 0.3s ease'
          }}
        >
          {isListening || isProcessing ? (
            <div style={{ width: 20, height: 20, border: '3px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          ) : (
            <HiMicrophone style={{ fontSize: 24, color: '#fff' }} />
          )}
        </button>

        {/* Status Text */}
        {status !== 'idle' && (
          <div style={{
            background: '#1e293b',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: 11,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}>
            {status === 'listening' && '🎤 Listening...'}
            {status === 'speak' && '🗣️ Speak now!'}
            {status === 'translating' && `🌐 Translating page...`}
            {status === 'transcribing' && '📝 Transcribing...'}
            {status === 'interpreting' && '🤖 Understanding...'}
            {status === 'executing' && '⚡ Executing...'}
            {status === 'success' && '✅ Done!'}
            {status === 'error' && '❌ Try again'}
          </div>
        )}

        {/* Translation Count */}
        {translatedCount > 0 && (
          <div style={{
            background: '#22c55e',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 11,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}>
            ✓ {translatedCount} items translated
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
