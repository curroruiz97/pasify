import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/cache/keys";
import { getSessionSnapshot } from "@/lib/cache/session";
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
 */

export type WalletTicketRow = WalletTicket & { event: TicketEventInfo | null };

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
      "id, event_id, tier_id, qr_token, status, buyer_user_id, transferred_to_user_id, buyer_first_name, buyer_last_name, buyer_email, holder_first_name, holder_last_name, holder_email, amount_paid_cents, used_at, paid_at"
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

  // Nombre del tipo de entrada (General, VIP…). Si RLS no deja leerlo
  // (tipo ya no activo), la entrada se enseña como "Entrada".
  const tierIds = Array.from(new Set(ticks.map((t) => t.tier_id).filter((id): id is string => !!id)));
  const tierNames = new Map<string, string>();
  if (tierIds.length > 0) {
    const { data: tierData, error: tierErr } = await supabase
      .from("ticket_tiers")
      .select("id, name")
      .in("id", tierIds);
    if (tierErr) console.warn("[mis entradas] ticket_tiers query failed", tierErr);
    (tierData ?? []).forEach((tr) => tierNames.set(tr.id, tr.name));
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
 * ciudad de la cabecera y los ajustes. Editar el perfil (EditPersonalInfoSheet)
 * o la foto la invalida y todos se actualizan a la vez.
 */
export function useMyProfile(uid: string | null) {
  return useQuery(perfilQuery(uid));
}

/** Ciudad del perfil del usuario (cabecera y ajustes). Misma consulta que useMyProfile. */
export function useMyCity(uid: string | null) {
  return useQuery({
    ...perfilQuery(uid),
    select: (perfil: MyProfile | null): { city: string | null } => ({ city: perfil?.city ?? null }),
  });
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
