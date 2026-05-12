import { useCallback, useEffect, useState } from "react";

const KEY = "pasify.fav.partners.v1";

const readStorage = (): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
};

/**
 * Locali (partner) salvati come favoriti — solo lista di id in localStorage.
 * I dati del locale vivono già nel DB o nell'array demo, quindi qui basta l'id.
 * Distinto da useFavorites (che invece serializza l'intero snapshot di un evento).
 */
export const useFavoritePartners = () => {
  const [ids, setIds] = useState<string[]>(readStorage);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(ids));
    } catch {
      /* storage piena / disabilitata */
    }
  }, [ids]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      try {
        const next = e.newValue ? (JSON.parse(e.newValue) as unknown) : [];
        if (Array.isArray(next)) {
          setIds(next.filter((x): x is string => typeof x === "string"));
        }
      } catch {
        /* noop */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const isFavorite = useCallback((id: string) => ids.includes(id), [ids]);

  const toggle = useCallback((id: string) => {
    setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  return { ids, isFavorite, toggle };
};
