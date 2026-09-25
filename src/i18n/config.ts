import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import es from "./locales/es.json";

/**
 * La app va solo en español (decisión D-12): un único idioma, sin selector.
 * Antes se cargaban seis JSON (~215 KB en el chunk principal) y se leía un
 * idioma guardado en localStorage que ya nada escribe.
 *
 * es.json solo lleva las claves que usa el código vivo. Una clave nueva va
 * aquí con su texto en español; si falta, i18next enseña el valor por defecto
 * de la llamada (`t("clave", "Texto")`) o la propia clave.
 */
i18n
  .use(initReactI18next)
  .init({
    resources: { es: { translation: es } },
    lng: "es",
    fallbackLng: "es",
    supportedLngs: ["es"],
    interpolation: {
      escapeValue: false,
    },
  })
  .catch((error) => {
    console.error("Failed to initialize i18n:", error);
  });

export default i18n;
