import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { withTimeout, TimeoutError } from "@/lib/withTimeout";
import { qk } from "@/lib/cache/keys";

/**
 * Datos del panel de local en la caché (React Query).
 *
 * Cada sección del panel se desmonta al cambiar de sección (SectionBoundary):
 * antes perdía sus datos y al volver pintaba "Cargando…" y los pedía otra
 * vez. Ahora viven aquí, compartidos: volver es instantáneo y solo se
 * refresca en segundo plano lo que tenga más de 30 s.
 */

/** Ninguna carga puede dejar el panel colgado en su loader. */
const LOAD_TIMEOUT_MS = 10_000;

/** Las consultas de Supabase son "thenables": withTimeout necesita una Promise. */
export function timed<T>(query: PromiseLike<T>, label: string): Promise<Awaited<T>> {
  return withTimeout(Promise.resolve(query), LOAD_TIMEOUT_MS, label);
}

export type PartnerEventRow = {
  id: string;
  title: string;
  description: string | null;
  city: string;
  date_start: string;
  date_end: string | null;
  status: string;
  price_cents: number;
  capacity: number | null;
  tickets_sold: number;
  image_url: string | null;
};

export type PartnerProfile = {
  id: string;
  business_name: string | null;
  business_category: string | null;
  city: string | null;
  business_city: string | null;
  account_status: string;
};

export type City = { id: string; name: string; slug: string };

const PROFILE_COLUMNS = "id, business_name, business_category, city, business_city, account_status";

/**
 * Eventos del local: los suyos (partner_id, legacy) y los de las
 * organizaciones de las que es miembro o dueño.
 */
async function leerEventosDelLocal(uid: string): Promise<PartnerEventRow[]> {
  let orgIds: string[] = [];
  try {
    const [members, owned] = await Promise.all([
      timed(
        supabase.from("organization_members").select("org_id").eq("user_id", uid).eq("status", "active"),
        "organization_members",
      ),
      // Fallback: organizations donde el user es owner_id directo
      timed(supabase.from("organizations").select("id").eq("owner_id", uid), "organizations"),
    ]);
    orgIds = (members.data ?? [])
      .map((m: { org_id: string | null }) => m.org_id)
      .filter((id): id is string => !!id);
    for (const o of (owned.data ?? []) as Array<{ id: string }>) {
      if (!orgIds.includes(o.id)) orgIds.push(o.id);
    }
  } catch (err) {
    // Sin respuesta: mejor un error visible que una lista incompleta.
    if (err instanceof TimeoutError) throw err;
    /* RLS o tabla no existente — caemos a sólo partner_id */
  }

  const filter =
    orgIds.length > 0 ? `partner_id.eq.${uid},org_id.in.(${orgIds.join(",")})` : `partner_id.eq.${uid}`;

  const { data, error } = await timed(
    supabase
      .from("events")
      .select("id, title, description, city, date_start, date_end, status, price_cents, capacity, tickets_sold, image_url")
      .or(filter)
      .order("date_start", { ascending: false }),
    "events",
  );
  if (error) throw error;
  return (data ?? []) as PartnerEventRow[];
}

export function usePartnerEvents(uid: string | null) {
  return useQuery({
    queryKey: qk.partner.events(uid ?? ""),
    queryFn: () => leerEventosDelLocal(uid as string),
    enabled: !!uid,
  });
}

export function usePartnerProfile(uid: string | null) {
  return useQuery({
    queryKey: qk.partner.profile(uid ?? ""),
    queryFn: async (): Promise<PartnerProfile | null> => {
      const { data, error } = await timed(
        supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", uid as string).maybeSingle(),
        "profiles",
      );
      if (error) throw error;
      return (data as PartnerProfile | null) ?? null;
    },
    enabled: !!uid,
    staleTime: 5 * 60_000,
  });
}

export function useCities() {
  return useQuery({
    queryKey: qk.public.cities(),
    queryFn: async (): Promise<City[]> => {
      const { data, error } = await timed(
        supabase.from("cities").select("id, name, slug").eq("active", true),
        "cities",
      );
      if (error) throw error;
      return (data ?? []) as City[];
    },
    staleTime: 60 * 60_000,
  });
}

/**
 * Secciones maqueta: solo la organización de demo (flag partner_showcase).
 * Sin organización todavía no hay nada que preguntar (el flag es por org).
 */
export function usePartnerShowcase(uid: string | null, orgId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.partner.showcase(uid ?? "", orgId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await timed(
        supabase.rpc("get_feature_flag", { _code: "partner_showcase", _org_id: orgId }),
        "get_feature_flag",
      );
      if (error) throw error;
      return data === true;
    },
    enabled: enabled && !!uid && !!orgId,
    staleTime: 10 * 60_000,
  });
}

export type BalanceRow = {
  paid_orders: number;
  gross_cents: number;
  refunded_cents: number;
  fee_cents: number;
  net_cents: number;
};

// partner_balance_v (security_invoker) aún no está en los types generados.
const leerSaldo = (orgId: string) =>
  (
    supabase as unknown as {
      from: (t: "partner_balance_v") => {
        select: (c: string) => {
          eq: (
            k: string,
            v: string,
          ) => { maybeSingle: () => Promise<{ data: BalanceRow | null; error: { message: string } | null }> };
        };
      };
    }
  )
    .from("partner_balance_v")
    .select("paid_orders, gross_cents, refunded_cents, fee_cents, net_cents")
    .eq("org_id", orgId)
    .maybeSingle();

export interface PartnerBalance {
  /** Cuenta de Stripe conectada y cobrando (lo que de verdad usa el checkout). */
  connected: boolean;
  balance: BalanceRow | null;
}

/** Cobros: si el local cobra con su Stripe y lo vendido hasta hoy. */
export function usePartnerBalance(uid: string | null, orgId: string | null) {
  return useQuery({
    queryKey: qk.partner.balance(uid ?? "", orgId ?? ""),
    queryFn: async (): Promise<PartnerBalance> => {
      const id = orgId as string;
      const [orgRes, balRes] = await Promise.all([
        timed(
          supabase
            .from("organizations")
            .select("stripe_connect_account_id, stripe_connect_charges_enabled")
            .eq("id", id)
            .maybeSingle(),
          "organizations.stripe",
        ),
        timed(leerSaldo(id), "partner_balance_v"),
      ]);
      if (balRes.error) throw balRes.error;
      const org = orgRes.data;
      return {
        connected:
          !orgRes.error && !!org?.stripe_connect_account_id && org?.stripe_connect_charges_enabled === true,
        balance: balRes.data,
      };
    },
    enabled: !!uid && !!orgId,
  });
}

/**
 * Tras crear, editar, publicar, cancelar o borrar un evento: fuera de fecha
 * todo lo que sale de los eventos (lista, primeros pasos, En vivo,
 * asistentes, informes, cobros, previsión). Se refresca ya lo que se está
 * viendo y el resto al volver a él. Devuelve cuando la lista está al día.
 */
export async function invalidarTrasCambioDeEventos(queryClient: QueryClient, uid: string): Promise<void> {
  const derivados = new Set(["context", "live", "attendees", "reports", "balance", "forecast"]);
  void queryClient.invalidateQueries({
    queryKey: qk.partner.all(uid),
    predicate: (q) => derivados.has(String(q.queryKey[2])),
  });
  await queryClient.invalidateQueries({ queryKey: qk.partner.events(uid) });
}
