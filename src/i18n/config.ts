import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import it from './locales/it.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import pt from './locales/pt.json';

const resources = {
  en: { translation: en },
  it: { translation: it },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  pt: { translation: pt },
};

// Get saved language from localStorage with error handling
let savedLanguage = 'es';
try {
  const storedLang = localStorage.getItem('appLanguage');
  if (storedLang) {
    savedLanguage = storedLang;
  }
} catch (error) {
  console.warn('Failed to read language from localStorage:', error);
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: savedLanguage,
    fallbackLng: 'es',
    interpolation: {
      escapeValue: false,
    },
  })
  .catch((error) => {
    console.error('Failed to initialize i18n:', error);
  });

export default i18n;
