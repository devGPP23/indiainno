import { useLanguage, LANGUAGES } from '../contexts/LanguageContext';
import { useState } from 'react';
import { HiOutlineGlobeAlt, HiOutlineChevronDown } from 'react-icons/hi';

export default function LanguageSwitcher({ inNavbar = false }) {
  const { currentLanguage, changeLanguage, languages, isLoading } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);

  const currentLang = languages.find(l => l.code === currentLanguage) || languages[0];

  const handleLanguageSelect = async (langCode) => {
    await changeLanguage(langCode);
    setIsOpen(false);
  };

  if (inNavbar) {
    return (
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: 'transparent',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
            color: '#1e293b'
          }}
        >
          <HiOutlineGlobeAlt style={{ fontSize: 16 }} />
          <span>{currentLang.flag} {currentLang.nativeName}</span>
          <HiOutlineChevronDown style={{ fontSize: 14 }} />
        </button>

        {isOpen && (
          <>
            <div 
              style={{ position: 'fixed', inset: 0, zIndex: 40 }} 
              onClick={() => setIsOpen(false)}
            />
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 4,
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              zIndex: 50,
              maxHeight: 300,
              overflow: 'auto',
              minWidth: 180
            }}>
              {languages.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => handleLanguageSelect(lang.code)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '10px 14px',
                    background: currentLanguage === lang.code ? '#f1f5f9' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: 13,
                    color: '#1e293b'
                  }}
                >
                  <span style={{ fontSize: 16 }}>{lang.flag}</span>
                  <span style={{ flex: 1 }}>{lang.nativeName}</span>
                  {currentLanguage === lang.code && (
                    <span style={{ color: '#22c55e', fontWeight: 600 }}>✓</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => setIsOpen(!isOpen)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: '#1e3a8a',
        color: '#fff',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 500
      }}
    >
      <HiOutlineGlobeAlt style={{ fontSize: 14 }} />
      <span>{currentLang.flag}</span>
      <span>{currentLang.name}</span>
      {isLoading && <span>...</span>}
    </button>
  );
}
