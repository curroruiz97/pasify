import { useEffect, useState } from "react";

const KEY = "pasify.fav.events.v3";

/**
 * Snapshot di un evento favoritato (salviamo i dati che servono in lista, così
 * la view "Favoritos" funziona anche per eventi demo che non vivono in DB).
 */
export type FavEvent = {
  id: string;
  partnerId: string;
  partnerName?: string;
  title: string;
  description: string | null;
  date_start: string;
  city: string;
  price_cents: number;
  capacity: number | null;
  tickets_sold: number;
  image_url: string | null;
};

const isValidFavEvent = (x: unknown): x is FavEvent =>
  !!x &&
  typeof x === "object" &&
  typeof (x as any).id === "string" &&
  typeof (x as any).title === "string" &&
  typeof (x as any).date_start === "string" &&
  !Number.isNaN(new Date((x as any).date_start).getTime());

const readStorage = (): FavEvent[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidFavEvent);
  } catch {
    return [];
  }
};

export const useFavorites = () => {
  const [events, setEvents] = useState<FavEvent[]>(readStorage);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(events));
    } catch {
      /* storage piena / disabilitata */
    }
  }, [events]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      try {
        setEvents(e.newValue ? (JSON.parse(e.newValue) as FavEvent[]) : []);
      } catch {
        /* noop */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const isFavorite = (id: string) => events.some((e) => e.id === id);

  const toggle = (event: FavEvent) => {
    setEvents((prev) =>
      prev.some((e) => e.id === event.id)
        ? prev.filter((e) => e.id !== event.id)
        : [...prev, event]
    );
  };

  return { events, ids: events.map((e) => e.id), isFavorite, toggle };
};
