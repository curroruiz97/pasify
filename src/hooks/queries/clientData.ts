import { useCallback, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { normalizeForSearch } from "@/data/spanish-cities";
import { useAuth } from "@/hooks/useAuth";
import { qk } from "@/lib/cache/keys";
import { getSessionSnapshot, useCurrentUserId } from "@/lib/cache/session";
import type { Ticket as WalletTicket, TicketEventInfo } from "@/components/client/TicketQRModal";

/**
 * Datos del panel de cliente en la caché (React Query).
 *
 * Las entradas se guardan en el dispositivo 30 días (cache/policy.ts): la
 * cartera se abre al instante y funciona en la puerta sin cobertura (el QR se
 * dibuja en el propio móvil a partir del token). Por eso no llevan datos
 * personales de terceros (ver sinDatosDeTerceros).
 *
 * Estados reales en la cartera: vienen también las entradas reembolsadas
 * (antes desaparecían sin dejar rastro al refrescar) y el estado del evento
 * ('cancelled' = sin QR, se devuelve el importe) con su hora de fin.
 *
 * Acciones de cada entrada (Ola 2): su pedido (order_id) para «Reenviar
 * email», la política de su tipo (si se puede enviar a otra persona y hasta
 * cuándo se puede pedir la devolución) y la transferencia pendiente, si la
 * hay. Son secundarias: si no se pueden leer, la entrada sale igual, sin esas
 * acciones.
 */

/** Política del tipo de entrada, la misma que aplica el servidor. */
export type PoliticaEntrada = {
  /** ticket_tiers.transfer_allowed: se puede enviar a otra persona. */
  transferible: boolean;
  /**
   * ticket_tiers.refundable_until_hours_before: la devolución se puede pedir
   * hasta N horas antes de empezar. null = «sin devolución (salvo cancelación)».
   */
  devolucionHastaHoras: number | null;
};

/**
 * Transferencia enviada y aún sin aceptar (ticket_transfers 'pending' de quien
 * la envía). Sin el email del destinatario: es un dato de otra persona y la
 * cartera se guarda en el dispositivo.
 */
export type TransferenciaPendiente = { id: string; caduca: string };

export type WalletTicketRow = WalletTicket & {
  event: TicketEventInfo | null;
  /** Comprador: solo él puede pedir que se le reenvíe el email del pedido. */
  buyer_user_id: string | null;
  /** Pedido de la entrada: «Reenviar email» reenvía el pedido entero. */
  order_id: string | null;
  /** null = no se ha podido leer: sin las acciones que dependen de ella. */
  politica: PoliticaEntrada | null;
  transferencia_pendiente: TransferenciaPendiente | null;
};

/**
 * Entrada sin tipo (anteriores a los tipos de entrada): el servidor deja
 * transferirlas y no tienen plazo de devolución.
 */
const POLITICA_SIN_TIPO: PoliticaEntrada = { transferible: true, devolucionHastaHoras: null };

/** Estados de entrada que enseña la cartera. 'refunded' va a la sección plegada. */
const ESTADOS_CARTERA = ["paid", "used", "refunded"] as const;

export type PublicPartner = {
  id: string;
  business_name: string | null;
  business_category: string | null;
  city: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
};

type CamposDePersonas = Pick<
  WalletTicket,
  "buyer_first_name" | "buyer_last_name" | "buyer_email" | "holder_first_name" | "holder_last_name" | "holder_email"
> & { buyer_user_id: string | null };

/**
 * Entrada recibida por transferencia: los `buyer_*` son del comprador
 * original, un tercero, y no se guardan (ticketHolderName ya no los usa en
 * las transferidas). Los `holder_*` los reescribe accept_ticket_transfer con
 * los datos de quien la recibe; en las aceptadas antes de ese cambio (no hubo
 * backfill) pueden seguir siendo del titular anterior, así que solo se
 * conservan si el email es el del usuario.
 *
 * Devuelve los campos que hay que pisar (nada si la entrada es suya).
 */
function sinDatosDeTerceros(
  t: CamposDePersonas,
  userId: string,
  email: string | null,
): Partial<CamposDePersonas> {
  if (t.buyer_user_id === userId) return {};
  const titularEsElUsuario = !!email && (t.holder_email ?? "").trim().toLowerCase() === email;
  return {
    buyer_first_name: null,
    buyer_last_name: null,
    buyer_email: "",
    ...(titularEsElUsuario ? {} : { holder_first_name: null, holder_last_name: null, holder_email: null }),
  };
}

/**
 * Entradas que tienes AHORA: compradas por ti y no transferidas, o
 * transferidas a ti. RLS ya filtra las que dejaste de tener; el filtro de
 * abajo aplica la misma regla por si la política cambia.
 *
 * Solo la consulta de entradas es imprescindible: si fallan los nombres de
 * tipo, evento o local, la entrada sale igual (con "Entrada"/"Evento").
 */
async function leerMisEntradas(userId: string): Promise<WalletTicketRow[]> {
  const { data: rows, error: tixErr } = await supabase
    .from("tickets")
    .select(
      "id, event_id, tier_id, order_id, qr_token, status, buyer_user_id, transferred_to_user_id, buyer_first_name, buyer_last_name, buyer_email, holder_first_name, holder_last_name, holder_email, amount_paid_cents, used_at, paid_at"
    )
    .or(`buyer_user_id.eq.${userId},transferred_to_user_id.eq.${userId}`)
    .in("status", [...ESTADOS_CARTERA])
    .order("paid_at", { ascending: false });
  if (tixErr) {
    console.error("[mis entradas] tickets query failed", tixErr);
    throw tixErr;
  }

  const ticks = (rows ?? []).filter((t) =>
    t.transferred_to_user_id ? t.transferred_to_user_id === userId : t.buyer_user_id === userId
  );
  if (ticks.length === 0) return [];

  // Nombre y política del tipo de entrada (General, VIP…). El titular lo lee
  // aunque el tipo ya no se venda (ticket_tiers_holder_read); si falla, la
  // entrada se enseña como "Entrada" y sin las acciones de su política.
  const tierIds = Array.from(new Set(ticks.map((t) => t.tier_id).filter((id): id is string => !!id)));
  const tierNames = new Map<string, string>();
  const politicas = new Map<string, PoliticaEntrada>();
  if (tierIds.length > 0) {
    const { data: tierData, error: tierErr } = await supabase
      .from("ticket_tiers")
      .select("id, name, transfer_allowed, refundable_until_hours_before")
      .in("id", tierIds);
    if (tierErr) console.warn("[mis entradas] ticket_tiers query failed", tierErr);
    (tierData ?? []).forEach((tr) => {
      tierNames.set(tr.id, tr.name);
      // Sin plazo (NULL) = sin devolución salvo cancelación.
      const horas = tr.refundable_until_hours_before as number | null;
      politicas.set(tr.id, {
        transferible: tr.transfer_allowed !== false,
        devolucionHastaHoras: typeof horas === "number" && Number.isFinite(horas) ? horas : null,
      });
    });
  }

  // Transferencias enviadas y aún sin aceptar («Transferencia pendiente»). RLS
  // (ticket_transfers_from_read) deja leer a quien la envía. Si falla, las
  // entradas salen igual.
  const pendientes = new Map<string, TransferenciaPendiente>();
  const pagadas = ticks.filter((t) => t.status === "paid").map((t) => t.id);
  if (pagadas.length > 0) {
    const { data: trData, error: trErr } = await supabase
      .from("ticket_transfers")
      .select("id, ticket_id, expires_at")
      .eq("from_user_id", userId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .in("ticket_id", pagadas)
      .order("created_at", { ascending: false });
    if (trErr) console.warn("[mis entradas] ticket_transfers query failed", trErr);
    (trData ?? []).forEach((tr) => {
      if (!pendientes.has(tr.ticket_id)) pendientes.set(tr.ticket_id, { id: tr.id, caduca: tr.expires_at });
    });
  }

  const eventIds = Array.from(new Set(ticks.map((t) => t.event_id).filter((id): id is string => !!id)));

  type WalletEventRow = {
    id: string;
    title: string | null;
    date_start: string | null;
    date_end: string | null;
    status: string | null;
    city: string | null;
    venue_name: string | null;
    image_url: string | null;
    partner_id: string | null;
  };
  let evs: WalletEventRow[] = [];
  if (eventIds.length > 0) {
    // RLS: el titular lee su evento también cancelado o retirado de la venta
    // (events_ticket_holder_read).
    const { data: evData, error: evErr } = await supabase
      .from("events")
      .select("id, title, date_start, date_end, status, city, venue_name, image_url, partner_id")
      .in("id", eventIds);
    if (evErr) console.warn("[mis entradas] events query failed", evErr);
    else evs = (evData ?? []) as WalletEventRow[];
  }

  // Filtrar partner_ids null: sin esto el .in() rompía la query (eventos
  // multi-tenant con org_id y sin partner_id).
  const partnerIds = Array.from(
    new Set(
      evs.map((e) => e.partner_id).filter((pid): pid is string => typeof pid === "string" && pid.length > 0)
    )
  );

  // Nombres de locales desde la vista pública `public_partners`: la lectura
  // directa de `profiles` de otros usuarios ya no está permitida.
  const partnerNames = new Map<string, string>();
  if (partnerIds.length > 0) {
    const { data: prData, error: prErr } = await supabase
      .from("public_partners")
      .select("id, business_name")
      .in("id", partnerIds);
    if (prErr) console.warn("[mis entradas] public_partners query failed", prErr);
    else
      (prData ?? []).forEach((p) => {
        if (p.id && p.business_name) partnerNames.set(p.id, p.business_name);
      });
  }

  const eventMap = new Map<string, TicketEventInfo>();
  evs.forEach((e) => {
    eventMap.set(e.id, {
      title: e.title ?? "Evento",
      date_start: e.date_start ?? new Date().toISOString(),
      date_end: e.date_end ?? null,
      status: e.status ?? null,
      city: e.city ?? "",
      venue_name: e.venue_name ?? null,
      image_url: e.image_url ?? null,
      partner_name: (e.partner_id && partnerNames.get(e.partner_id)) || undefined,
    });
  });

  // Email de la sesión solo si es la de este usuario (un cambio de cuenta a
  // medias no puede dar por buenos los datos de otro).
  const sesion = getSessionSnapshot().session;
  const email = sesion?.user?.id === userId ? sesion.user.email?.trim().toLowerCase() || null : null;

  return ticks.map((t) => ({
    ...t,
    ...sinDatosDeTerceros(t, userId, email),
    tier_name: t.tier_id ? tierNames.get(t.tier_id) ?? null : null,
    politica: t.tier_id ? politicas.get(t.tier_id) ?? null : POLITICA_SIN_TIPO,
    transferencia_pendiente: pendientes.get(t.id) ?? null,
    event: eventMap.get(t.event_id) ?? null,
  }));
}

export function useMyTickets(uid: string | null) {
  return useQuery({
    queryKey: qk.me.tickets(uid ?? ""),
    queryFn: () => leerMisEntradas(uid as string),
    enabled: !!uid,
    // Que no se vaya de la memoria antes que del dispositivo (30 días).
    gcTime: 30 * 24 * 60 * 60_000,
  });
}

/**
 * Locales aprobados (vista `public_partners`, que ya filtra
 * account_status='approved' y business_name no nulo).
 */
export function usePublicPartners() {
  return useQuery({
    queryKey: qk.public.partners(),
    queryFn: async (): Promise<PublicPartner[]> => {
      const { data, error } = await supabase
        .from("public_partners")
        .select("id, business_name, business_category, city, avatar_url, cover_image_url")
        .order("business_name");
      if (error) {
        // Antes el catch silencioso lo enmascaraba como "no hay locales".
        console.error("[locales] public_partners query failed", error);
        throw error;
      }
      return (data ?? []) as PublicPartner[];
    },
    staleTime: 5 * 60_000,
  });
}

/** Perfil propio (nombre, email, ciudad, foto). Datos del usuario: se guardan 7 días. */
export type MyProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  city: string | null;
  avatar_url: string | null;
  created_at: string | null;
};

async function leerMiPerfil(uid: string): Promise<MyProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email, city, avatar_url, created_at")
    .eq("id", uid)
    .maybeSingle();
  if (error) throw error;
  return (data as MyProfile | null) ?? null;
}

const perfilQuery = (uid: string | null) => ({
  queryKey: qk.me.profile(uid ?? ""),
  queryFn: () => leerMiPerfil(uid as string),
  enabled: !!uid,
  staleTime: 10 * 60_000,
});

/**
 * Perfil del usuario, una sola consulta para toda la app (qk.me.profile):
 * la hoja de perfil (montada dos veces, barra lateral y cabecera móvil), la
 * ciudad (useCiudadElegida) y los ajustes. Editar el perfil
 * (EditPersonalInfoSheet), la ciudad o la foto la actualiza y todos se
 * enteran a la vez.
 */
export function useMyProfile(uid: string | null) {
  return useQuery(perfilQuery(uid));
}

// ============================================================================
// Ciudad (B2-10): una sola, la del perfil, que filtra Inicio y el Calendario
// ============================================================================

/** Sin ciudad (profiles.city vacía): se ve lo de toda España. */
export const TODA_ESPANA = "Toda España";

/**
 * La misma ciudad escrita de otra forma en los listados que conviven: la
 * tabla `cities` (ciudad de los eventos), el alta de cliente
 * (constants/countries) y SpanishCitySelect (data/spanish-cities: el perfil y
 * los locales). Clave normalizada → clave común.
 */
const ALIAS_CIUDAD: Record<string, string> = {
  "palma de mallorca": "palma",
  eivissa: "ibiza",
  "mao mahon": "mahon",
  mao: "mahon",
  "donostia san sebastian": "san sebastian",
  donostia: "san sebastian",
  "castello de la plana": "castellon",
  "castellon de la plana": "castellon",
  castello: "castellon",
  vitoria: "vitoria gasteiz",
  gasteiz: "vitoria gasteiz",
  "la coruna": "a coruna",
  alacant: "alicante",
  elx: "elche",
  gerona: "girona",
  lerida: "lleida",
  orense: "ourense",
};

/**
 * Clave para comparar ciudades: sin acentos, mayúsculas ni guiones y con los
 * alias resueltos ("Maó-Mahón" y "Mahón" dan lo mismo). null si está vacía.
 */
export function claveCiudad(nombre: string | null | undefined): string | null {
  const n = normalizeForSearch(nombre ?? "")
    .replace(/[-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return null;
  return ALIAS_CIUDAD[n] ?? n;
}

/** ¿`ciudad` está en la ciudad elegida? Sin ciudad elegida (Toda España), todo vale. */
export function enCiudad(ciudad: string | null | undefined, elegida: string | null | undefined): boolean {
  const filtro = claveCiudad(elegida);
  return !filtro || claveCiudad(ciudad) === filtro;
}

// Sin sesión (o en una cuenta que no es de cliente), la ciudad vive en el
// dispositivo, con la misma clave de siempre. "selectedCountry" es del
// selector de países de antes: con otro país guardado no hay nada que ver.
const CLAVE_CIUDAD = "selectedCity";
const CLAVE_PAIS = "selectedCountry";
const avisosCiudad = new Set<() => void>();
/** Sin localStorage (modo privado antiguo): dura lo que la visita. */
let ciudadEnMemoria: string | null = null;

function leerCiudadLocal(): string | null {
  try {
    const pais = localStorage.getItem(CLAVE_PAIS);
    if (pais && pais !== "ES") return null;
    return localStorage.getItem(CLAVE_CIUDAD)?.trim() || null;
  } catch {
    return ciudadEnMemoria;
  }
}

function guardarCiudadLocal(ciudad: string | null) {
  ciudadEnMemoria = ciudad;
  try {
    if (ciudad) localStorage.setItem(CLAVE_CIUDAD, ciudad);
    else localStorage.removeItem(CLAVE_CIUDAD);
    localStorage.removeItem(CLAVE_PAIS);
  } catch {
    /* sin storage: solo en memoria */
  }
  avisosCiudad.forEach((aviso) => aviso());
}

function suscribirCiudadLocal(aviso: () => void) {
  avisosCiudad.add(aviso);
  // Otra pestaña la cambia.
  const alCambiar = (e: StorageEvent) => {
    if (e.key === null || e.key === CLAVE_CIUDAD || e.key === CLAVE_PAIS) aviso();
  };
  window.addEventListener("storage", alCambiar);
  return () => {
    avisosCiudad.delete(aviso);
    window.removeEventListener("storage", alCambiar);
  };
}

/**
 * La ciudad elegida: una sola para Inicio (locales y próximos eventos) y el
 * Calendario. null = «Toda España».
 *
 *  - Cliente con sesión: la de su perfil (profiles.city, qk.me.profile). La
 *    cambia en Editar perfil, en Inicio o en el Calendario, y se guarda en el
 *    perfil al momento (cambio optimista; si falla, vuelve y avisa).
 *  - Sin sesión, y en cuentas que no son de cliente, en el dispositivo
 *    (localStorage "selectedCity", como hasta ahora). En un local,
 *    profiles.city es la ciudad pública de su ficha: el calendario no la toca.
 */
export function useCiudadElegida() {
  const uid = useCurrentUserId();
  const { effectiveRole } = useAuth();
  const enPerfil = !!uid && effectiveRole === "client";
  const perfil = useMyProfile(enPerfil ? uid : null);
  const local = useSyncExternalStore(suscribirCiudadLocal, leerCiudadLocal, leerCiudadLocal);
  const queryClient = useQueryClient();

  const { mutateAsync, isPending } = useMutation({
    // Sin conexión falla al momento (y se deshace) en vez de quedarse en espera.
    networkMode: "always",
    mutationFn: async ({ usuario, ciudad }: { usuario: string; ciudad: string | null }) => {
      const { error } = await supabase.from("profiles").update({ city: ciudad }).eq("id", usuario);
      if (error) throw error;
    },
    onMutate: async ({ usuario, ciudad }) => {
      const key = qk.me.profile(usuario);
      await queryClient.cancelQueries({ queryKey: key });
      const previo = queryClient.getQueryData<MyProfile | null>(key);
      queryClient.setQueryData<MyProfile | null>(key, (p) => (p ? { ...p, city: ciudad } : p));
      return { previo };
    },
    onError: (err, { usuario }, contexto) => {
      console.warn("[ciudad] no se pudo guardar en el perfil", err);
      queryClient.setQueryData(qk.me.profile(usuario), contexto?.previo);
      toast.error("No se ha podido cambiar tu ciudad", { description: "Revisa tu conexión e inténtalo de nuevo." });
    },
    onSettled: (_d, _e, { usuario }) => queryClient.invalidateQueries({ queryKey: qk.me.profile(usuario) }),
  });

  /** Devuelve false si no se ha podido guardar (ya se ha avisado). */
  const cambiarCiudad = useCallback(
    async (nueva: string | null): Promise<boolean> => {
      const ciudad = nueva?.trim() || null;
      if (enPerfil && uid) {
        try {
          await mutateAsync({ usuario: uid, ciudad });
          return true;
        } catch {
          return false;
        }
      }
      guardarCiudadLocal(ciudad);
      return true;
    },
    [enPerfil, uid, mutateAsync],
  );

  return {
    ciudad: enPerfil ? perfil.data?.city?.trim() || null : local,
    cambiarCiudad,
    guardando: isPending,
    /** Primera carga del perfil, sin nada guardado: aún no se sabe la ciudad. */
    cargando: enPerfil && perfil.data === undefined && perfil.fetchStatus === "fetching",
  };
}

/**
 * Modo demo de la app del cliente (D-7): flag `client_showcase` de
 * get_feature_flag con el id del usuario (la cuenta de demo está en
 * tenant_overrides). Apagado para todos por defecto. Solo en memoria: se
 * pregunta al entrar y un fallo o la falta de red cuentan como "no".
 */
export function useClientShowcase(uid: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.me.clientShowcase(uid ?? ""),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("get_feature_flag", {
        _code: "client_showcase",
        _org_id: uid as string,
      });
      if (error) throw error;
      return data === true;
    },
    enabled: enabled && !!uid,
    staleTime: 10 * 60_000,
    retry: 1,
  });
}
