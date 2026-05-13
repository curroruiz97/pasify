import { Building2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
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
}: Props) => {
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
            <SelectValue placeholder="Madrid" />
          </SelectTrigger>
          <SelectContent>
            {cities.map((c) => (
              <SelectItem key={c.id} value={c.name}>
                {c.name}
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
          placeholder="C. de Atocha, 125, 28012 Madrid"
          disabled={disabled}
          className="mt-1.5"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Esta dirección se muestra al cliente en el ticket y se usará para el
          mapa de cómo llegar.
        </p>
      </div>
    </div>
  );
};

export default EventLocationSection;
