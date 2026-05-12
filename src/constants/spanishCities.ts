// Backward compatibility: re-export from countries.ts
import { CITIES_BY_COUNTRY, getCitiesForCountry } from "./countries";

export const SPANISH_CITIES = CITIES_BY_COUNTRY.ES;

export type SpanishCity = (typeof SPANISH_CITIES)[number];

export const DEFAULT_CITY = "Valladolid";

export const getCityById = (id: string) =>
  SPANISH_CITIES.find(city => city.id === id);

export const getCityByName = (name: string) =>
  SPANISH_CITIES.find(city => city.name.toLowerCase() === name.toLowerCase());

// Re-export for convenience
export { getCitiesForCountry };
