/**
 * useDiscounts · LEGACY NEUTRALIZED stub.
 *
 * En Pasify los partners tenían "discounts" (cupones canjeables vía QR).
 * En Pasify el modelo cambió a venta directa de tickets (tabla `tickets` +
 * `ticket_tiers` + Stripe Connect), así que `discounts` y `discount_scans` ya
 * no existen. Mantenemos el export para que `PartnerDiscounts.tsx` (cliente)
 * compile, pero devuelve lista vacía.
 */

import { useQueryClient } from "@tanstack/react-query";

export interface Discount {
  id: string;
  partner_id: string;
  title: string;
  description: string | null;
  discount_percentage: number;
  start_date: string;
  end_date: string;
  image_url: string | null;
  category: string | null;
  partner?: {
    business_name: string | null;
    business_city: string | null;
  } | null;
}

export const useAllDiscounts = () => ({
  data: [] as Discount[],
  isLoading: false,
  error: null as Error | null,
});

export const usePartnerDiscounts = (_partnerId?: string) => ({
  data: [] as Discount[],
  isLoading: false,
  error: null as Error | null,
});

export const useInvalidateDiscounts = () => {
  const queryClient = useQueryClient();
  return {
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: ["discounts"] });
    },
  };
};
