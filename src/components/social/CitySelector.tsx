import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { MapPin, Search, Check } from "lucide-react";
import { COUNTRIES, getCitiesForCountry, DEFAULT_COUNTRY } from "@/constants/countries";
import { useTranslation } from "react-i18next";

interface CitySelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCity: string;
  onCityChange: (city: string) => void;
  selectedCountry?: string;
  onCountryChange?: (country: string) => void;
  isPartner?: boolean;
}

const CitySelector = ({
  open,
  onOpenChange,
  selectedCity,
  onCityChange,
  selectedCountry: externalCountry,
  onCountryChange,
  isPartner = false,
}: CitySelectorProps) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [internalCountry, setInternalCountry] = useState(
    () => externalCountry || localStorage.getItem("selectedCountry") || DEFAULT_COUNTRY
  );

  const activeCountry = externalCountry ?? internalCountry;
  const cities = getCitiesForCountry(activeCountry);

  const filteredCities = cities.filter(
    (city) =>
      city.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      city.province.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCountryChange = (countryCode: string) => {
    setInternalCountry(countryCode);
    localStorage.setItem("selectedCountry", countryCode);
    if (onCountryChange) {
      onCountryChange(countryCode);
    }
    const country = COUNTRIES.find((c) => c.code === countryCode);
    if (country) {
      onCityChange(country.defaultCity);
      localStorage.setItem("selectedCity", country.defaultCity);
    }
    setSearchQuery("");
  };

  const handleSelectCity = (cityName: string) => {
    onCityChange(cityName);
    localStorage.setItem("selectedCity", cityName);
    onOpenChange(false);
    setSearchQuery("");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl max-h-[85vh] flex flex-col px-4 pb-8"
      >
        {/* Drag Handle */}
        <div className="flex justify-center pt-2 pb-4">
          <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
        </div>

        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center justify-center gap-2 text-xl">
            <MapPin className="w-5 h-5 text-primary" />
            {t("citySelector.title") || "Seleziona città"}
          </SheetTitle>
        </SheetHeader>

        {isPartner ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <p>{t("citySelector.partnerNote") || "I partner non possono cambiare città. Contatta il supporto se devi aggiornare la tua posizione."}</p>
          </div>
        ) : (
          <>
            {/* Country Flags Row */}
            <div className="flex justify-center gap-2 mb-4">
              {COUNTRIES.map((country) => (
                <button
                  key={country.code}
                  onClick={() => handleCountryChange(country.code)}
                  className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
                    activeCountry === country.code
                      ? "bg-primary/10 border-2 border-primary scale-105"
                      : "bg-gray-50 border-2 border-transparent hover:bg-gray-100"
                  }`}
                >
                  <span className="text-2xl">{country.flag}</span>
                  <span className="text-[10px] font-medium text-gray-600">{country.code}</span>
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
                type="text"
                placeholder={t("citySelector.searchPlaceholder") || "Cerca città..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 h-12 rounded-xl bg-gray-100 border-0 text-base"
              />
            </div>

            {/* Cities List */}
            <div className="flex-1 overflow-y-auto space-y-2 -mx-1 px-1">
              {filteredCities.map((city) => (
                <button
                  key={city.id}
                  onClick={() => handleSelectCity(city.name)}
                  className={`w-full flex items-center justify-between p-4 rounded-xl transition-all active:scale-[0.98] ${
                    selectedCity === city.name
                      ? "bg-primary/10 border-2 border-primary"
                      : "bg-gray-50 hover:bg-gray-100 border-2 border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-11 h-11 rounded-full flex items-center justify-center ${
                        selectedCity === city.name
                          ? "bg-primary text-white"
                          : "bg-white text-gray-500 shadow-sm"
                      }`}
                    >
                      <MapPin className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <p className="font-semibold text-base">{city.name}</p>
                      <p className="text-sm text-gray-500">{city.province}</p>
                    </div>
                  </div>
                  {selectedCity === city.name && (
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                      <Check className="w-5 h-5 text-white" />
                    </div>
                  )}
                </button>
              ))}

              {filteredCities.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <MapPin className="w-16 h-16 mx-auto mb-3 opacity-20" />
                  <p className="text-lg">{t("citySelector.noResults") || "Nessuna città trovata"}</p>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default CitySelector;
