import { useLanguage } from '../contexts/LanguageContext';
import { useState, useEffect } from 'react';

export default function TranslatedText({ children, className, style }) {
  const { translate, currentLanguage, isTranslating } = useLanguage();
  const [translated, setTranslated] = useState(children);

  useEffect(() => {
    const translateText = async () => {
      if (currentLanguage === 'en-IN' || !children) {
        setTranslated(children);
        return;
      }
      
      const textToTranslate = typeof children === 'string' ? children : String(children || '');
      const result = await translate(textToTranslate);
      setTranslated(result);
    };

    translateText();
  }, [children, currentLanguage, translate]);

  return (
    <span className={className} style={style}>
      {translated}
      {isTranslating && currentLanguage !== 'en-IN' && (
        <span style={{ opacity: 0.5, fontSize: '0.8em' }}>...</span>
      )}
    </span>
  );
}

export function TranslatedH1({ children, ...props }) {
  return <TranslatedText as="h1" {...props}>{children}</TranslatedText>;
}

export function TranslatedH2({ children, ...props }) {
  return <TranslatedText as="h2" {...props}>{children}</TranslatedText>;
}

export function TranslatedH3({ children, ...props }) {
  return <TranslatedText as="h3" {...props}>{children}</TranslatedText>;
}

export function TranslatedP({ children, ...props }) {
  return <TranslatedText as="p" {...props}>{children}</TranslatedText>;
}

export function TranslatedButton({ children, ...props }) {
  return <TranslatedText as="button" {...props}>{children}</TranslatedText>;
}
