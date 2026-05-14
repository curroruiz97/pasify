import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
 */

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
   * Mensaje de error si la RPC `partner_onboarding_status` falló. Cuando
   * NO es null, los consumidores DEBEN mostrar un banner de error en vez
   * de fingir éxito (status="completed" en silencio). Esto evita que un
   * fallo de RPC en producción se enmascare como dashboard funcional.
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

export const usePartnerContext = (userId: string | null): UsePartnerContextResult => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [org, setOrg] = useState<PartnerOrg | null>(null);
  const [brand, setBrand] = useState<PartnerBrand | null>(null);
  const [venue, setVenue] = useState<PartnerVenue | null>(null);
  const [venues, setVenues] = useState<PartnerVenue[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    setRefreshing(true);
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
      const { data, error: rpcError } = await rpcAny.rpc("partner_onboarding_status");
      if (rpcError) {
        // No camuflamos el fallo como "completed silencioso" — eso
        // ocultaba problemas reales en producción (mig no aplicada,
        // RPC revocada, etc.). Devolvemos `error` explícito y el
        // consumidor (PartnerDashboard) muestra un banner de retry.
        console.error("[usePartnerContext] RPC error:", rpcError.message);
        setError(rpcError.message);
        setStatus(null);
        setOrg(null);
        setVenue(null);
        setVenues([]);
        setBrand(null);
        return;
      }
      // Limpiamos error si la RPC respondió OK tras un retry.
      setError(null);

      const row: RpcRow | null = Array.isArray(data)
        ? data[0] ?? null
        : (data as RpcRow | null);

      if (!row) {
        setStatus(null);
        setOrg(null);
        setVenue(null);
        setVenues([]);
        setBrand(null);
        return;
      }

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
      setStatus(mapped);

      // 2) Si hay org, cargar la fila completa
      if (mapped.primaryOrgId) {
        const { data: orgRow } = await supabase
          .from("organizations")
          .select(
            "id, slug, name, legal_name, country, city, address, postal_code, billing_email, contact_email, contact_phone, vat_id, metadata"
          )
          .eq("id", mapped.primaryOrgId)
          .maybeSingle();
        setOrg((orgRow as PartnerOrg | null) ?? null);

        // 3) Brand asociado (el create_organization crea exactamente 1)
        const { data: brandRow } = await supabase
          .from("brands")
          .select(
            "id, org_id, slug, name, tagline, description, logo_url, cover_image_url, primary_color, accent_color, website_url, instagram_handle"
          )
          .eq("org_id", mapped.primaryOrgId)
          .order("sort_order", { ascending: true })
          .limit(1)
          .maybeSingle();
        setBrand((brandRow as PartnerBrand | null) ?? null);
      } else {
        setOrg(null);
        setBrand(null);
      }

      // 4) Si hay org, cargar TODOS los venues activos (multi-local)
      //    y elegir el "principal" (primer activo creado). Pasify
      //    soporta hasta N locales por organización (ver migración 0011).
      if (mapped.primaryOrgId) {
        const { data: venueRows } = await supabase
          .from("venues")
          .select(
            "id, brand_id, org_id, slug, name, business_category, address, city, postal_code, country, timezone, capacity, cover_image_url, description, phone, email, opening_hours, status"
          )
          .eq("org_id", mapped.primaryOrgId)
          .eq("status", "active")
          .order("created_at", { ascending: true });
        const list = (venueRows as PartnerVenue[] | null) ?? [];
        setVenues(list);
        // Venue "primario" = el que la RPC nos dijo, o el primero activo
        const primary =
          (mapped.primaryVenueId
            ? list.find((v) => v.id === mapped.primaryVenueId)
            : null) ?? list[0] ?? null;
        setVenue(primary);
      } else {
        setVenue(null);
        setVenues([]);
      }
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loading, refreshing, status, org, brand, venue, venues, error, refresh: load };
};

export default usePartnerContext;
