import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Alta de cuentas: lo que viaja en los metadatos de signUp y lo que prepara
 * la cuenta de local en el servidor.
 *
 * Los datos del formulario van en `options.data` junto a `initial_role`: con
 * «Confirm email» activado no hay sesión para guardarlos en el perfil, y el
 * trigger de alta (migración 20260928140000) los copia allí al crear el
 * usuario. La organización y el plan del local los crea
 * `complete_partner_signup` (idempotente): el alta si ya tiene sesión, y si no
 * PartnerGate al entrar al panel tras confirmar.
 */

type RespuestaRpc = { data: unknown; error: PostgrestError | null };

/** RPC que aún no está en los tipos generados (src/integrations/supabase/types.ts). */
export const llamarRpc = (nombre: string, args?: Record<string, unknown>): Promise<RespuestaRpc> =>
  Promise.resolve(
    (supabase.rpc as unknown as (fn: string, a?: Record<string, unknown>) => PromiseLike<RespuestaRpc>).call(
      supabase,
      nombre,
      args,
    ),
  );

/** El servidor aún no tiene esa función (frontend desplegado antes que la migración). */
export const esFuncionQueNoExiste = (error: { code?: string; message?: string } | null | undefined): boolean =>
  !!error && (error.code === "PGRST202" || /could not find the function/i.test(error.message ?? ""));

const texto = (valor: string | null | undefined): string | undefined => {
  const limpio = (valor ?? "").trim();
  return limpio ? limpio : undefined;
};

export interface DatosAltaLocal {
  businessName: string;
  businessCategory: string;
  businessAddress: string;
  businessCountry: string;
  businessCity: string;
  businessPhone: string;
}

/** Metadatos de signUp del alta de local (el trigger los pasa al perfil). */
export const metadatosAltaLocal = (d: DatosAltaLocal) => ({
  initial_role: "partner",
  business_name: texto(d.businessName),
  business_category: texto(d.businessCategory),
  business_address: texto(d.businessAddress),
  business_country: texto(d.businessCountry),
  business_city: texto(d.businessCity),
  business_phone: texto(d.businessPhone),
});

export interface DatosAltaCliente {
  firstName: string;
  lastName: string;
  phone: string;
  country: string;
  city: string;
  /** Código de "Trae un amigo" (?ref=), ya normalizado. */
  ref?: string | null;
}

/** Metadatos de signUp del alta de cliente. */
export const metadatosAltaCliente = (d: DatosAltaCliente) => ({
  initial_role: "client",
  first_name: texto(d.firstName),
  last_name: texto(d.lastName),
  phone: texto(d.phone),
  country: texto(d.country),
  city: texto(d.city),
  ref: d.ref ?? undefined,
});

/**
 * Organización y plan gratuito del local que ha entrado. Devuelve el error
 * (o null). Con un servidor sin complete_partner_signup hace lo de antes:
 * en un alta nueva, la organización con el nombre del negocio, y el plan.
 */
export async function prepararCuentaDeLocal(altaNueva?: { nombre: string; pais: string }): Promise<PostgrestError | null> {
  const { error } = await llamarRpc("complete_partner_signup");
  if (!error) return null;
  if (!esFuncionQueNoExiste(error)) return error;

  if (altaNueva?.nombre.trim()) {
    const { error: orgError } = await supabase.rpc("create_organization", {
      _name: altaNueva.nombre.trim(),
      _country: altaNueva.pais,
      _slug: null,
    });
    if (orgError) return orgError;
  }
  const { error: planError } = await supabase.rpc("claim_partner_free_plan");
  return planError;
}
