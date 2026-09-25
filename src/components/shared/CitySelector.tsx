import { useMemo, useState } from "react";
import { Check, Globe2, MapPin, Search } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { SPANISH_CITIES, normalizeForSearch } from "@/data/spanish-cities";
import { TODA_ESPANA, claveCiudad } from "@/hooks/queries/clientData";

interface CitySelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ciudad elegida; null = «Toda España». */
  selectedCity: string | null;
  /** null = «Toda España». */
  onCityChange: (city: string | null) => void;
}

/**
 * Selector de ciudad (hoja inferior) del Calendario y de Inicio.
 *
 * Solo España: los mismos municipios que SpanishCitySelect (el del perfil),
 * con «Toda España» arriba. La ciudad la guarda quien lo abre
 * (useCiudadElegida: el perfil del cliente o, sin sesión, el dispositivo).
 *
 * Colores del tema (bg-card, text-foreground, text-muted-foreground…): antes
 * las filas eran bg-gray-50 con el texto claro del tema oscuro y no se leían.
 */
const CitySelector = ({ open, onOpenChange, selectedCity, onCityChange }: CitySelectorProps) => {
  const [busqueda, setBusqueda] = useState("");
  const consulta = normalizeForSearch(busqueda);
  const claveElegida = claveCiudad(selectedCity);

  const ciudades = useMemo(
    () =>
      consulta
        ? SPANISH_CITIES.filter((c) => normalizeForSearch(`${c.name} ${c.province} ${c.ccaa}`).includes(consulta))
        : SPANISH_CITIES,
    [consulta],
  );
  // La elegida puede no estar en la lista (escrita a mano, o del alta antigua
  // con "Palma de Mallorca"): se enseña arriba para que se vea cuál es.
  const elegidaFueraDeLista =
    !!selectedCity && !!claveElegida && !SPANISH_CITIES.some((c) => claveCiudad(c.name) === claveElegida);
  const verTodaEspana = !consulta || normalizeForSearch(TODA_ESPANA).includes(consulta);

  const cambiarApertura = (abierta: boolean) => {
    onOpenChange(abierta);
    if (!abierta) setBusqueda("");
  };
  const elegir = (ciudad: string | null) => {
    onCityChange(ciudad);
    cambiarApertura(false);
  };

  return (
    <Sheet open={open} onOpenChange={cambiarApertura}>
      <SheetContent
        side="bottom"
        className="flex max-h-[85vh] flex-col rounded-t-3xl border-border bg-card px-4 pb-8 text-foreground"
      >
        <SheetHeader className="pb-4 pt-3">
          <SheetTitle className="flex items-center justify-center gap-2 text-xl text-foreground">
            <MapPin className="h-5 w-5 text-primary" />
            Elige tu ciudad
          </SheetTitle>
          <SheetDescription className="text-center text-muted-foreground">
            Verás los locales y los eventos de esa ciudad, o los de toda España.
          </SheetDescription>
        </SheetHeader>

        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Busca tu ciudad o provincia"
            aria-label="Buscar ciudad"
            className="h-12 rounded-xl border-border bg-muted pl-12 text-base text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <ul className="-mx-1 flex-1 space-y-2 overflow-y-auto px-1" aria-label="Ciudades">
          {verTodaEspana && (
            <FilaCiudad
              nombre={TODA_ESPANA}
              detalle="Sin filtrar por ciudad"
              elegida={!claveElegida}
              icono={<Globe2 className="h-5 w-5" />}
              onClick={() => elegir(null)}
            />
          )}
          {elegidaFueraDeLista && !consulta && (
            <FilaCiudad nombre={selectedCity as string} detalle="Tu ciudad" elegida onClick={() => elegir(selectedCity)} />
          )}
          {ciudades.map((c) => (
            <FilaCiudad
              key={`${c.name}-${c.province}`}
              nombre={c.name}
              detalle={c.province === c.name ? c.ccaa : c.province}
              elegida={!!claveElegida && claveCiudad(c.name) === claveElegida}
              onClick={() => elegir(c.name)}
            />
          ))}

          {ciudades.length === 0 && !verTodaEspana && (
            <li className="py-12 text-center text-muted-foreground">
              <MapPin className="mx-auto mb-3 h-12 w-12 opacity-30" />
              <p className="text-base">No encontramos esa ciudad.</p>
            </li>
          )}
        </ul>
      </SheetContent>
    </Sheet>
  );
};

const FilaCiudad = ({
  nombre,
  detalle,
  elegida,
  icono,
  onClick,
}: {
  nombre: string;
  detalle: string;
  elegida: boolean;
  icono?: React.ReactNode;
  onClick: () => void;
}) => (
  <li>
    <button
      type="button"
      onClick={onClick}
      aria-pressed={elegida}
      className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border-2 p-3 text-left transition active:scale-[0.99] ${
        elegida ? "border-primary bg-primary/10" : "border-transparent bg-muted/50 hover:bg-muted"
      }`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            elegida ? "bg-primary text-primary-foreground" : "border border-border bg-background text-muted-foreground"
          }`}
        >
          {icono ?? <MapPin className="h-5 w-5" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-foreground">{nombre}</span>
          <span className="block truncate text-sm text-muted-foreground">{detalle}</span>
        </span>
      </span>
      {elegida && (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-4 w-4" />
        </span>
      )}
    </button>
  </li>
);

export default CitySelector;
