// Pasify · ficheros del usuario en Storage que se borran con su cuenta.
//
//   - avatars/<uid>/…       foto de perfil (ProfileSheet la sube ahí).
//   - gdpr-exports/<uid>/…  copias de su exportación de datos (flujo DSAR).
//
// Lo que es del local (event-images, partner-branding…) se queda: sus
// eventos y su organización se conservan (partner_close_account). Borrar
// filas de storage.objects por SQL no borra el fichero: hay que usar la API.

import { supabaseAdmin } from "../_shared/supabase.ts";

export const BUCKETS_DEL_USUARIO = ["avatars", "gdpr-exports"] as const;

const PAGINA = 100;
const MAX_POR_CARPETA = 2_000;
const MAX_PROFUNDIDAD = 3;

const noExiste = (error: unknown): boolean => {
  const e = error as { statusCode?: unknown; status?: unknown; message?: unknown } | null;
  return (
    String(e?.statusCode ?? e?.status ?? "") === "404" ||
    /not.?found/i.test(typeof e?.message === "string" ? e.message : "")
  );
};

/** Rutas de todos los ficheros bajo `carpeta` (sin la barra final). */
async function listar(bucket: string, carpeta: string, profundidad = 0): Promise<string[]> {
  const rutas: string[] = [];
  for (let offset = 0; offset < MAX_POR_CARPETA; offset += PAGINA) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).list(carpeta, { limit: PAGINA, offset });
    if (error) {
      if (noExiste(error)) return rutas;
      throw error;
    }
    const filas = data ?? [];
    for (const fila of filas) {
      const ruta = `${carpeta}/${fila.name}`;
      // Las carpetas vienen sin id.
      if (fila.id === null) {
        if (profundidad < MAX_PROFUNDIDAD) rutas.push(...(await listar(bucket, ruta, profundidad + 1)));
      } else {
        rutas.push(ruta);
      }
    }
    if (filas.length < PAGINA) break;
  }
  return rutas;
}

export interface BorradoStorage {
  bucket: string;
  borrados: number;
}

/**
 * Borra los ficheros del usuario. Lanza si Storage falla (quien llama no
 * borra la cuenta y el usuario puede reintentar); un bucket que no existe
 * cuenta como vacío.
 */
export async function borrarFicherosDelUsuario(userId: string): Promise<BorradoStorage[]> {
  const resultado: BorradoStorage[] = [];
  for (const bucket of BUCKETS_DEL_USUARIO) {
    const rutas = await listar(bucket, userId);
    for (let i = 0; i < rutas.length; i += PAGINA) {
      const { error } = await supabaseAdmin.storage.from(bucket).remove(rutas.slice(i, i + PAGINA));
      if (error && !noExiste(error)) throw error;
    }
    resultado.push({ bucket, borrados: rutas.length });
  }
  return resultado;
}
