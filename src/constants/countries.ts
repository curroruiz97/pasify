// Multi-country support: ES, FR, IT, PT

export interface Country {
  code: string;
  name: string;
  flag: string;
  mapboxCode: string;
  defaultCity: string;
  defaultCoords: [number, number]; // [lng, lat]
}

export interface City {
  id: string;
  name: string;
  province: string;
}

export const COUNTRIES: Country[] = [
  { code: "ES", name: "España", flag: "🇪🇸", mapboxCode: "ES", defaultCity: "Valladolid", defaultCoords: [-3.7038, 40.4168] },
  { code: "FR", name: "France", flag: "🇫🇷", mapboxCode: "FR", defaultCity: "Paris", defaultCoords: [2.3522, 48.8566] },
  { code: "IT", name: "Italia", flag: "🇮🇹", mapboxCode: "IT", defaultCity: "Milano", defaultCoords: [12.4964, 41.9028] },
  { code: "PT", name: "Portugal", flag: "🇵🇹", mapboxCode: "PT", defaultCity: "Lisboa", defaultCoords: [-9.1393, 38.7223] },
];

export const CITIES_BY_COUNTRY: Record<string, City[]> = {
  ES: [
    { id: "valladolid", name: "Valladolid", province: "Valladolid" },
    { id: "madrid", name: "Madrid", province: "Madrid" },
    { id: "barcelona", name: "Barcelona", province: "Barcelona" },
    { id: "valencia", name: "Valencia", province: "Valencia" },
    { id: "sevilla", name: "Sevilla", province: "Sevilla" },
    { id: "zaragoza", name: "Zaragoza", province: "Zaragoza" },
    { id: "malaga", name: "Málaga", province: "Málaga" },
    { id: "murcia", name: "Murcia", province: "Murcia" },
    { id: "palma", name: "Palma de Mallorca", province: "Islas Baleares" },
    { id: "bilbao", name: "Bilbao", province: "Vizcaya" },
    { id: "alicante", name: "Alicante", province: "Alicante" },
    { id: "cordoba", name: "Córdoba", province: "Córdoba" },
    { id: "granada", name: "Granada", province: "Granada" },
    { id: "salamanca", name: "Salamanca", province: "Salamanca" },
    { id: "leon", name: "León", province: "León" },
    { id: "burgos", name: "Burgos", province: "Burgos" },
    { id: "santander", name: "Santander", province: "Cantabria" },
    { id: "oviedo", name: "Oviedo", province: "Asturias" },
    { id: "pamplona", name: "Pamplona", province: "Navarra" },
    { id: "san-sebastian", name: "San Sebastián", province: "Guipúzcoa" },
    { id: "vitoria", name: "Vitoria-Gasteiz", province: "Álava" },
    { id: "logrono", name: "Logroño", province: "La Rioja" },
    { id: "toledo", name: "Toledo", province: "Toledo" },
    { id: "albacete", name: "Albacete", province: "Albacete" },
    { id: "badajoz", name: "Badajoz", province: "Badajoz" },
    { id: "caceres", name: "Cáceres", province: "Cáceres" },
    { id: "huelva", name: "Huelva", province: "Huelva" },
    { id: "almeria", name: "Almería", province: "Almería" },
    { id: "cadiz", name: "Cádiz", province: "Cádiz" },
    { id: "jaen", name: "Jaén", province: "Jaén" },
  ],
  FR: [
    { id: "paris", name: "Paris", province: "Île-de-France" },
    { id: "lyon", name: "Lyon", province: "Auvergne-Rhône-Alpes" },
    { id: "marseille", name: "Marseille", province: "Provence-Alpes-Côte d'Azur" },
    { id: "toulouse", name: "Toulouse", province: "Occitanie" },
    { id: "bordeaux", name: "Bordeaux", province: "Nouvelle-Aquitaine" },
    { id: "lille", name: "Lille", province: "Hauts-de-France" },
    { id: "montpellier", name: "Montpellier", province: "Occitanie" },
    { id: "strasbourg", name: "Strasbourg", province: "Grand Est" },
    { id: "nantes", name: "Nantes", province: "Pays de la Loire" },
    { id: "rennes", name: "Rennes", province: "Bretagne" },
    { id: "grenoble", name: "Grenoble", province: "Auvergne-Rhône-Alpes" },
    { id: "nice", name: "Nice", province: "Provence-Alpes-Côte d'Azur" },
    { id: "aix-en-provence", name: "Aix-en-Provence", province: "Provence-Alpes-Côte d'Azur" },
    { id: "clermont-ferrand", name: "Clermont-Ferrand", province: "Auvergne-Rhône-Alpes" },
    { id: "rouen", name: "Rouen", province: "Normandie" },
    { id: "dijon", name: "Dijon", province: "Bourgogne-Franche-Comté" },
    { id: "poitiers", name: "Poitiers", province: "Nouvelle-Aquitaine" },
    { id: "tours", name: "Tours", province: "Centre-Val de Loire" },
    { id: "nancy", name: "Nancy", province: "Grand Est" },
    { id: "caen", name: "Caen", province: "Normandie" },
  ],
  IT: [
    { id: "milano", name: "Milano", province: "Lombardia" },
    { id: "roma", name: "Roma", province: "Lazio" },
    { id: "napoli", name: "Napoli", province: "Campania" },
    { id: "torino", name: "Torino", province: "Piemonte" },
    { id: "bologna", name: "Bologna", province: "Emilia-Romagna" },
    { id: "firenze", name: "Firenze", province: "Toscana" },
    { id: "padova", name: "Padova", province: "Veneto" },
    { id: "genova", name: "Genova", province: "Liguria" },
    { id: "pisa", name: "Pisa", province: "Toscana" },
    { id: "catania", name: "Catania", province: "Sicilia" },
    { id: "palermo", name: "Palermo", province: "Sicilia" },
    { id: "bari", name: "Bari", province: "Puglia" },
    { id: "perugia", name: "Perugia", province: "Umbria" },
    { id: "verona", name: "Verona", province: "Veneto" },
    { id: "siena", name: "Siena", province: "Toscana" },
    { id: "trento", name: "Trento", province: "Trentino-Alto Adige" },
    { id: "parma", name: "Parma", province: "Emilia-Romagna" },
    { id: "modena", name: "Modena", province: "Emilia-Romagna" },
    { id: "cagliari", name: "Cagliari", province: "Sardegna" },
    { id: "trieste", name: "Trieste", province: "Friuli-Venezia Giulia" },
  ],
  PT: [
    { id: "lisboa", name: "Lisboa", province: "Lisboa" },
    { id: "porto", name: "Porto", province: "Porto" },
    { id: "coimbra", name: "Coimbra", province: "Coimbra" },
    { id: "braga", name: "Braga", province: "Braga" },
    { id: "aveiro", name: "Aveiro", province: "Aveiro" },
    { id: "faro", name: "Faro", province: "Faro" },
    { id: "evora", name: "Évora", province: "Évora" },
    { id: "funchal", name: "Funchal", province: "Madeira" },
    { id: "viseu", name: "Viseu", province: "Viseu" },
    { id: "guimaraes", name: "Guimarães", province: "Braga" },
    { id: "leiria", name: "Leiria", province: "Leiria" },
    { id: "setubal", name: "Setúbal", province: "Setúbal" },
    { id: "vila-real", name: "Vila Real", province: "Vila Real" },
    { id: "castelo-branco", name: "Castelo Branco", province: "Castelo Branco" },
    { id: "beja", name: "Beja", province: "Beja" },
  ],
};

export const getCitiesForCountry = (countryCode: string): City[] => {
  return CITIES_BY_COUNTRY[countryCode] || [];
};

export const getCountryByCode = (code: string): Country | undefined => {
  return COUNTRIES.find((c) => c.code === code);
};

export const DEFAULT_COUNTRY = "ES";
