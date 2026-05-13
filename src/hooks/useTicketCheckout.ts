import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

/**
 * useTicketCheckout — hook único de compra de tickets reutilizable entre
 * `Calendar.tsx` (descubrimiento) y `PublicPartnerPage.tsx` (perfil del
 * local) + cualquier otra superficie que muestre un botón "Comprar entrada".
 *
 * Flujo:
 *   1. Si el evento es demo (`id` empieza con `demo-`) → toast informativo
 *      y salir. Los eventos demo viven solo en frontend para showcase.
 *   2. Comprueba sesión. Si no hay → redirige a `/register-client` con
 *      `?next=` apuntando a la URL actual para volver tras login.
 *   3. Busca el `ticket_tier` activo con menor `sort_order` para el evento.
 *      Sin tier activo → toast "Venta no disponible".
 *   4. Lee `profiles` para autopopular el buyer (first/last name + phone).
 *   5. POST a edge function `stripe-create-checkout` con payload limpio.
 *      `success_url` apunta a `/#/client-dashboard` (sin query). El edge
 *      function añade `?order_id=<uuid>&session_id={CHECKOUT_SESSION_ID}`
 *      y ClientDashboard parsea esos params para abrir el wallet y poll.
 *   6. Redirige a Stripe hosted checkout.
 *
 * Devuelve `{ checkout, pendingId }`. `pendingId` es el id del evento en
 * curso (o `null`). Las superficies que muestren varias cards pueden usar
 * `pendingId === event.id` para desactivar el botón concreto que está
 * procesando.
 */

export interface TicketCheckoutInput {
  /** event_id real de la tabla events. Si empieza con `demo-` es de muestra. */
  id: string;
  /** Opcional. Usado solo para logging/contexto. */
  title?: string;
}

export const useTicketCheckout = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const checkout = useCallback(
    async (input: TicketCheckoutInput) => {
      // Re-entrancy guard: si otra compra está en curso, ignora el click.
      if (pendingId) return;

      // Eventos demo: no existen en DB ni tienen ticket_tier. Mostramos toast
      // explícito en vez de fallar contra Stripe.
      if (input.id.startsWith("demo-")) {
        toast({
          title: "Evento de muestra",
          description:
            "Este es un evento de muestra. La compra estará disponible cuando el partner publique eventos reales.",
        });
        return;
      }

      setPendingId(input.id);
      try {
        // 1) Sesión obligatoria
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          // Conserva la ruta para volver tras registro
          const currentPath =
            window.location.hash.startsWith("#/")
              ? window.location.hash.slice(1)
              : "/calendar";
          navigate(
            `/register-client?next=${encodeURIComponent(currentPath)}`
          );
          return;
        }

        // 2) Tier activo del evento
        const { data: tiers, error: tiersErr } = await supabase
          .from("ticket_tiers")
          .select("id, name, price_cents, status, sort_order")
          .eq("event_id", input.id)
          .eq("status", "active")
          .order("sort_order", { ascending: true })
          .limit(1);
        if (tiersErr) throw new Error(tiersErr.message);
        const tier = tiers?.[0];
        if (!tier) {
          toast({
            title: "Venta no disponible",
            description:
              "Este evento aún no tiene entradas a la venta. Vuelve a probar más tarde.",
            variant: "destructive",
          });
          return;
        }

        // 3) Buyer info del profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("first_name, last_name, phone")
          .eq("id", session.user.id)
          .maybeSingle();

        const buyer = {
          email: session.user.email || "",
          first_name: profile?.first_name ?? undefined,
          last_name: profile?.last_name ?? undefined,
          phone: profile?.phone ?? undefined,
        };
        if (!buyer.email) {
          throw new Error("No se encontró tu email. Revisa tu perfil.");
        }

        // 4) Edge function — payload limpio. success_url SIN query, el edge
        // function añade `?order_id=<uuid>&session_id={CHECKOUT_SESSION_ID}`.
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-create-checkout`;
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            event_id: input.id,
            tier_id: tier.id,
            qty: 1,
            buyer,
            locale: "es",
            success_url: `${window.location.origin}/#/client-dashboard`,
            cancel_url: `${window.location.origin}/#/calendar`,
          }),
        });

        if (resp.status === 404) {
          toast({
            title: "Checkout próximamente",
            description:
              "El sistema de pago está siendo desplegado. Vuelve a intentarlo en unos minutos.",
          });
          return;
        }

        const raw = await resp.text();
        if (!resp.ok) {
          let detail = raw;
          try {
            const parsed = JSON.parse(raw);
            detail = parsed?.error || parsed?.message || parsed?.code || raw;
          } catch {
            /* noop */
          }
          throw new Error(`${resp.status}: ${detail}`);
        }

        const data = JSON.parse(raw);
        if (data?.url) {
          // Redirect a Stripe Checkout hosted. El control vuelve a
          // /#/client-dashboard?order_id=...&session_id=... tras pago OK.
          window.location.href = data.url;
          return;
        }
        throw new Error("Respuesta inesperada del servidor de pagos.");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Error inesperado";
         
        console.error("[useTicketCheckout] checkout failed", e);
        toast({
          title: "Error",
          description: msg,
          variant: "destructive",
        });
      } finally {
        setPendingId(null);
      }
    },
    [pendingId, navigate, toast]
  );

  return { checkout, pendingId };
};

export default useTicketCheckout;
