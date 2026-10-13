import { Building2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cityOptions, samePlace, type EventPlace } from "@/lib/eventPlace";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * EventLocationSection — ciudad (select) + venue + dirección exacta.
 *
 * Persiste contra columnas existentes de `events`:
 *   - city          → text (obligatorio)
 *   - venue_name    → text (nombre del local)
 *   - address       → text (dirección exacta para mapa)
 *
 * Estas tres columnas YA existen en la migración 0010 (events table). No
 * hace falta migración. El mapa de detalle del evento (futuro) puede
 * geocodificar address en build time o lazy.
 */

export interface LocationValue {
  city: string;
  venueName: string;
  address: string;
}

interface Props {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  cities: Array<{ id: string; name: string; slug: string }>;
  disabled?: boolean;
  /**
   * Lugar del local elegido. Si el de arriba no coincide, se avisa y se ofrece
   * volver a los datos del local (el evento guarda su propia copia del lugar).
   */
  venuePlace?: EventPlace | null;
}

/** Validación humana — devuelve mensaje de error o null si OK. */
export const validateLocation = (v: LocationValue): string | null => {
  if (!v.city.trim()) return "Selecciona la ciudad del evento";
  if (!v.address.trim()) return "Añade la dirección exacta del evento";
  return null;
};

export const EventLocationSection = ({
  value,
  onChange,
  cities,
  disabled,
  venuePlace = null,
}: Props) => {
  // Las de la lista y, si no está, la que hay guardada: el selector enseña
  // siempre lo que tiene el evento y nunca un texto de ejemplo.
  const ciudades = cityOptions(cities, value.city).filter(Boolean);
  const distinto = venuePlace !== null && !samePlace(value, venuePlace);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="evt-city" className="flex items-center gap-2 text-xs">
          <Building2 className="h-3.5 w-3.5 text-orange-500" />
          Ciudad *
        </Label>
        <Select
          value={value.city || ""}
          onValueChange={(v) => onChange({ ...value, city: v })}
          disabled={disabled}
        >
          <SelectTrigger id="evt-city" className="mt-1.5">
            <SelectValue placeholder="Elige la ciudad" />
          </SelectTrigger>
          <SelectContent>
            {ciudades.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="evt-venue" className="flex items-center gap-2 text-xs">
          <Building2 className="h-3.5 w-3.5 text-orange-500" />
          Nombre del local
        </Label>
        <Input
          id="evt-venue"
          value={value.venueName}
          onChange={(e) => onChange({ ...value, venueName: e.target.value })}
          placeholder="Teatro Kapital"
          disabled={disabled}
          className="mt-1.5"
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="evt-addr" className="flex items-center gap-2 text-xs">
          <MapPin className="h-3.5 w-3.5 text-orange-500" />
          Ubicación exacta *
        </Label>
        <Input
          id="evt-addr"
          value={value.address}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
          placeholder="Calle, número y código postal"
          disabled={disabled}
          className="mt-1.5"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Esta dirección se muestra al cliente en el ticket y se usará para el
          mapa de cómo llegar.
        </p>
      </div>
      {distinto && venuePlace && (
        <div
          role="note"
          data-testid="lugar-distinto-del-local"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground sm:col-span-2"
        >
          <span className="min-w-0 flex-1">
            Estos datos no son los de tu local
            {venuePlace.venueName || venuePlace.city ? (
              <>
                {" "}
                (<span className="text-foreground">{[venuePlace.venueName, venuePlace.city].filter(Boolean).join(" · ")}</span>)
              </>
            ) : null}
            . Si no es intencionado, vuelve a los del local.
          </span>
          <button
            type="button"
            onClick={() => onChange({ ...venuePlace })}
            disabled={disabled}
            className="shrink-0 rounded-md border border-orange-500/40 px-2.5 py-1 text-[12px] font-medium text-orange-500 transition hover:bg-orange-500/10 disabled:opacity-50"
          >
            Usar los datos del local
          </button>
        </div>
      )}
    </div>
  );
};

export default EventLocationSection;
