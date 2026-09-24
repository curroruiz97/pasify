import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/withTimeout";
import { captureError, getErrorMessage } from "@/lib/sentry";
import { qk } from "@/lib/cache/keys";

/**
 * usePartnerContext — fuente única de verdad de la organización y venue
 * activos del partner + estado real (server-side) del onboarding.
 *
 * Cubre 3 necesidades de la dashboard:
 *   1. Saber si hay que abrir el wizard (`shouldShowWizard`) — sale
 *      directamente de la RPC `partner_onboarding_status` que ya
 *      combina senales reales (`organizations` propias o miembro,
 *      `venues`, `events`) con el flag explicito en `partner_onboarding_state`.
 *   2. Cargar el row completo de `organizations` + `venues` para
 *      pintar nombre + ciudad + categoria en el chrome (sidebar /
 *      MobileTopBar / SettingsSheet).
 *   3. Refrescar tras completar el wizard o tras guardar cambios en
 *      Configuracion sin tener que recargar la pagina.
 *
 * El hook NUNCA depende de localStorage. La unica fuente de verdad es
 * Supabase. Si un mismo usuario cambia de dispositivo o limpia cache,
 * el estado correcto se sincroniza.
 *
 * Robustez (Fase 0):
 *  - RPC y consultas con límite de 10 s (`withTimeout`): una petición
 *    colgada ya no deja el panel esperando para siempre.
 *  - Todo o nada: el estado solo se actualiza cuando la RPC y las consultas
 *    de org/brand/venues han ido bien. Si algo falla en un refresco se
 *    CONSERVAN los datos previos y se expone `error` (banner "Reintentar"
 *    del dashboard). Antes un fallo dejaba org/venue a null en silencio y un
 *    asistente con `venues=[]` podía creer que no había local.
 *  - `loading` solo es true en la primera carga de cada usuario; los
 *    refrescos usan `refreshing`.
 *
 * Caché: la foto completa (estado + org + brand + venues) vive en
 * qk.partner.context, compartida entre pantallas y guardada en el
 * dispositivo: al recargar el panel sale ya con el nombre del local y la
 * lista de primeros pasos, y se revalida detrás. `refresh()` fuerza la
 * lectura.
 */

// Límite por petición.
const CONTEXT_TIMEOUT_MS = 10_000;

/** Consulta de Supabase (thenable) con límite de tiempo. */
function conTimeout<T>(query: PromiseLike<T>, label: string): Promise<Awaited<T>> {
  return withTimeout(Promise.resolve(query), CONTEXT_TIMEOUT_MS, label);
}

export interface OnboardingStatus {
  userId: string;
  hasOrg: boolean;
  hasVenue: boolean;
  hasEvent: boolean;
  status: "in_progress" | "completed" | "skipped";
  completedAt: string | null;
  primaryOrgId: string | null;
  primaryVenueId: string | null;
  shouldShowWizard: boolean;
}

export interface PartnerOrg {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  country: string;
  city: string | null;
  address: string | null;
  postal_code: string | null;
  billing_email: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  vat_id: string | null;
  metadata: Record<string, unknown>;
}

export interface PartnerVenue {
  id: string;
  brand_id: string;
  org_id: string;
  slug: string;
  name: string;
  business_category: string | null;
  address: string | null;
  city: string;
  postal_code: string | null;
  country: string;
  timezone: string;
  capacity: number | null;
  cover_image_url: string | null;
  description: string | null;
  phone: string | null;
  email: string | null;
  opening_hours: Record<string, unknown>;
  status: string;
}

export interface PartnerBrand {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  website_url: string | null;
  instagram_handle: string | null;
}

interface UsePartnerContextResult {
  loading: boolean;
  refreshing: boolean;
  status: OnboardingStatus | null;
  org: PartnerOrg | null;
  brand: PartnerBrand | null;
  /** Venue principal (primer venue activo creado, normalmente el "Principal"). */
  venue: PartnerVenue | null;
  /** Todos los venues activos de la organización (multi-local). */
  venues: PartnerVenue[];
  /**
   * Mensaje de error si la RPC `partner_onboarding_status` (o la carga de
   * org/brand/venues) falló o no respondió a tiempo. Cuando NO es null, los
   * consumidores DEBEN mostrar un banner de error en vez de fingir éxito
   * (status="completed" en silencio). Esto evita que un fallo de RPC en
   * producción se enmascare como dashboard funcional. Los datos de la última
   * carga buena se conservan.
   */
  error: string | null;
  refresh: () => Promise<void>;
}

type RpcRow = {
  user_id: string;
  has_org: boolean;
  has_venue: boolean;
  has_event: boolean;
  onboarding_status: string;
  completed_at: string | null;
  primary_org_id: string | null;
  primary_venue_id: string | null;
  should_show_wizard: boolean;
};

interface Snapshot {
  status: OnboardingStatus | null;
  org: PartnerOrg | null;
  brand: PartnerBrand | null;
  venue: PartnerVenue | null;
  venues: PartnerVenue[];
}

const SNAPSHOT_VACIO: Snapshot = { status: null, org: null, brand: null, venue: null, venues: [] };

async function leerContexto(): Promise<Snapshot> {
  try {
    // 1) Llama a la RPC que combina todas las senales server-side.
    //    Cast hasta que regeneremos los types post-migration.
    const rpcAny = supabase as unknown as {
      rpc: (
        name: string,
        args?: Record<string, unknown>
      ) => Promise<{
        data: RpcRow[] | RpcRow | null;
        error: { message: string } | null;
      }>;
    };
    const { data, error: rpcError } = await withTimeout(
      Promise.resolve(rpcAny.rpc("partner_onboarding_status")),
      CONTEXT_TIMEOUT_MS,
      "rpc partner_onboarding_status",
    );
    // No camuflamos el fallo como "completed silencioso" — eso ocultaba
    // problemas reales en producción (mig no aplicada, RPC revocada, etc.).
    // Devolvemos `error` explícito y el consumidor (PartnerDashboard)
    // muestra un banner de retry.
    if (rpcError) throw rpcError;

    const row: RpcRow | null = Array.isArray(data)
      ? data[0] ?? null
      : (data as RpcRow | null);
    if (!row) return SNAPSHOT_VACIO;

    const mapped: OnboardingStatus = {
      userId: row.user_id,
      hasOrg: row.has_org,
      hasVenue: row.has_venue,
      hasEvent: row.has_event,
      status: (row.onboarding_status as OnboardingStatus["status"]) ?? "in_progress",
      completedAt: row.completed_at,
      primaryOrgId: row.primary_org_id,
      primaryVenueId: row.primary_venue_id,
      shouldShowWizard: row.should_show_wizard,
    };
    if (!mapped.primaryOrgId) return { status: mapped, org: null, brand: null, venue: null, venues: [] };

    // 2) Fila completa de la org, 3) brand asociado (create_organization
    //    crea exactamente 1) y 4) TODOS los venues activos (multi-local,
    //    ver migración 0011). Son independientes: en paralelo.
    const [orgRes, brandRes, venuesRes] = await Promise.all([
      conTimeout(
        supabase
          .from("organizations")
          .select(
            "id, slug, name, legal_name, country, city, address, postal_code, billing_email, contact_email, contact_phone, vat_id, metadata"
          )
          .eq("id", mapped.primaryOrgId)
          .maybeSingle(),
        "organizations",
      ),
      conTimeout(
        supabase
          .from("brands")
          .select(
            "id, org_id, slug, name, tagline, description, logo_url, cover_image_url, primary_color, accent_color, website_url, instagram_handle"
          )
          .eq("org_id", mapped.primaryOrgId)
          .order("sort_order", { ascending: true })
          .limit(1)
          .maybeSingle(),
        "brands",
      ),
      conTimeout(
        supabase
          .from("venues")
          .select(
            "id, brand_id, org_id, slug, name, business_category, address, city, postal_code, country, timezone, capacity, cover_image_url, description, phone, email, opening_hours, status"
          )
          .eq("org_id", mapped.primaryOrgId)
          .eq("status", "active")
          .order("created_at", { ascending: true }),
        "venues",
      ),
    ]);
    const fallo = orgRes.error ?? brandRes.error ?? venuesRes.error;
    if (fallo) throw fallo;

    const list = (venuesRes.data as PartnerVenue[] | null) ?? [];
    // Venue "primario" = el que la RPC nos dijo, o el primero activo
    const primary =
      (mapped.primaryVenueId
        ? list.find((v) => v.id === mapped.primaryVenueId)
        : null) ?? list[0] ?? null;
    return {
      status: mapped,
      org: (orgRes.data as PartnerOrg | null) ?? null,
      brand: (brandRes.data as PartnerBrand | null) ?? null,
      venues: list,
      venue: primary,
    };
  } catch (err) {
    console.error("[usePartnerContext] error:", getErrorMessage(err));
    captureError(err, { where: "usePartnerContext.load" });
    throw err;
  }
}

export const usePartnerContext = (userId: string | null): UsePartnerContextResult => {
  const query = useQuery({
    queryKey: qk.partner.context(userId ?? ""),
    queryFn: leerContexto,
    enabled: !!userId,
  });

  const { refetch } = query;
  const refresh = useCallback(async () => {
    if (!userId) return;
    await refetch();
  }, [userId, refetch]);

  // Los datos de la última carga buena se conservan aunque un refresco falle.
  const snap = (userId ? query.data : undefined) ?? SNAPSHOT_VACIO;
  return {
    loading: !!userId && query.isPending,
    refreshing: !!userId && query.isFetching,
    status: snap.status,
    org: snap.org,
    brand: snap.brand,
    venue: snap.venue,
    venues: snap.venues,
    error: userId && query.error ? getErrorMessage(query.error) : null,
    refresh,
  };
};

export default usePartnerContext;
