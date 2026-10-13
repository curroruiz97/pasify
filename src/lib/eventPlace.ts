/**
 * Lugar de un evento (`events.city`, `events.venue_name`, `events.address`).
 *
 * El evento guarda una copia del lugar de su local (para poder cambiarlo sin
 * tocar el local), y TODAS las pantallas lo leen de esa copia. Si la copia se
 * queda con datos de otro local («Principal · Madrid» del local por defecto de
 * la cuenta), se ve en la página del evento, en la entrada, en el email… Por
 * eso hay un único sitio donde se decide:
 *   - qué lugar toma un evento al asignarle un local (`placeFromVenue`): el del
 *     local, entero, sin heredar nada del anterior;
 *   - cómo se escribe ese lugar a quien compra (`formatEventPlace`).
 */

/** Lo que guarda un evento. Cadenas vacías = sin dato. */
export interface EventPlace {
  city: string;
  venueName: string;
  address: string;
}

/** Un local de la organización (o lo que de él se conoce). */
export interface VenueLike {
  id?: string;
  name?: string | null;
  city?: string | null;
  address?: string | null;
}

/** Nombre con el que la plataforma crea el primer local de una cuenta. */
export const PLACEHOLDER_VENUE_NAME = "Principal";

const limpia = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/** Para comparar: sin mayúsculas, tildes ni espacios de más. */
const clave = (s: string | null | undefined): string =>
  limpia(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** El nombre es el de relleno de la cuenta nueva («Principal»): no dice nada a quien compra. */
export const esNombreDeRelleno = (name: string | null | undefined): boolean =>
  clave(name) === clave(PLACEHOLDER_VENUE_NAME);

/**
 * Lugar de un evento al asignarle `venue`: el del local, entero. Lo que le
 * falte al local queda vacío (el editor lo pide); nunca se conserva el valor
 * del local anterior.
 */
export function placeFromVenue(venue: VenueLike | null | undefined): EventPlace {
  return { city: limpia(venue?.city), venueName: limpia(venue?.name), address: limpia(venue?.address) };
}

/** ¿Es el mismo lugar? (sin distinguir mayúsculas, tildes ni espacios de más) */
export function samePlace(a: EventPlace, b: EventPlace): boolean {
  return clave(a.city) === clave(b.city) && clave(a.venueName) === clave(b.venueName) && clave(a.address) === clave(b.address);
}

/**
 * El local aún tiene los datos de relleno con los que se creó la cuenta
 * («Principal», sin dirección): sus eventos saldrían con un nombre y una
 * ciudad que nadie ha escrito.
 */
export function esLocalSinCompletar(venue: VenueLike | null | undefined): boolean {
  if (!venue) return false;
  return esNombreDeRelleno(venue.name) && !limpia(venue.address);
}

/**
 * Texto de un local en el selector. Si dos locales darían el mismo texto
 * («Principal · Madrid» ×3) se añade la dirección y, si siguen iguales, un
 * número, para poder distinguirlos.
 */
export function venueOptionLabel(venue: VenueLike, all: readonly VenueLike[]): string {
  const base = [limpia(venue.name), limpia(venue.city)].filter(Boolean).join(" · ") || "Local sin nombre";
  const mismoBase = all.filter((v) => [limpia(v.name), limpia(v.city)].filter(Boolean).join(" · ") === base);
  if (mismoBase.length <= 1) return base;
  const conDireccion = limpia(venue.address) ? `${base} · ${limpia(venue.address)}` : base;
  const igual = mismoBase.filter((v) => `${base}${limpia(v.address) ? ` · ${limpia(v.address)}` : ""}` === conDireccion);
  if (igual.length <= 1) return conDireccion;
  const orden = igual.findIndex((v) => v === venue || (v.id !== undefined && v.id === venue.id));
  return `${conDireccion} (${orden + 1})`;
}

/**
 * Ciudades del selector: las de la lista y, si no está, la del valor actual,
 * para que el selector enseñe siempre lo que hay guardado y no un texto de
 * ejemplo.
 */
export function cityOptions(cities: ReadonlyArray<{ name: string }>, current: string): string[] {
  const nombres = cities.map((c) => c.name);
  const actual = limpia(current);
  if (actual && !nombres.some((n) => clave(n) === clave(actual))) nombres.push(actual);
  return nombres;
}

export interface EventPlaceSource {
  venue_name?: string | null;
  address?: string | null;
  city?: string | null;
}

export interface FormattedPlace {
  /** «Sala · Ciudad» (o lo que haya): tarjetas, entradas y confirmaciones. */
  short: string;
  /** «Sala · Dirección · Ciudad»: página del evento. */
  long: string;
  /** «Sala, Dirección, Ciudad»: búsqueda de «Cómo llegar». */
  maps: string;
  /** Nombre del sitio que se enseña (vacío si es el de relleno). */
  name: string;
}

/**
 * Cómo se escribe el lugar de un evento. Los trozos repetidos («Madrid ·
 * Madrid») se quitan y el nombre de relleno de la cuenta nueva («Principal»)
 * no se enseña. `business` es el nombre comercial del local, que ocupa el
 * lugar del nombre si el del sitio es el de relleno.
 */
export function formatEventPlace(source: EventPlaceSource | null | undefined, business?: string | null): FormattedPlace {
  const rawName = limpia(source?.venue_name);
  const name = !rawName || esNombreDeRelleno(rawName) ? limpia(business) : rawName;
  const address = limpia(source?.address);
  const city = limpia(source?.city);

  const sinRepetir = (trozos: string[]): string[] => {
    const vistos = new Set<string>();
    return trozos.filter((t) => {
      if (!t) return false;
      const k = clave(t);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  };
  // La ciudad ya escrita dentro de la dirección («…, 28012 Madrid») no se repite.
  const ciudadEnDireccion = city !== "" && clave(address).includes(clave(city));
  const short = sinRepetir([name, city]).join(" · ");
  const long = sinRepetir([name, address, ciudadEnDireccion ? "" : city]).join(" · ");
  const maps = sinRepetir([name, address, ciudadEnDireccion ? "" : city]).join(", ");
  return { short, long, maps, name };
}
