import { Badge } from "@/components/ui/badge";

/**
 * StatusBadge — estado de evento / aprobación reutilizable entre la tabla
 * desktop (`PartnerDashboard.tsx`) y la card móvil (`EventRowCard.tsx`).
 * Mantiene el mapeo de status → label + clases tonal-warm (success / warning /
 * destructive / muted) consistente con el design system Pasify.
 */
export const StatusBadge = ({ status }: { status: string }) => {
  const variant: Record<string, { label: string; cls: string }> = {
    approved: { label: "Aprobado", cls: "bg-success/15 text-success border-success/30" },
    pending: { label: "Pendiente", cls: "bg-warning/15 text-warning border-warning/30" },
    rejected: { label: "Rechazado", cls: "bg-destructive/15 text-destructive border-destructive/30" },
    published: { label: "Publicado", cls: "bg-success/15 text-success border-success/30" },
    draft: { label: "Borrador", cls: "bg-muted text-muted-foreground border-border" },
    cancelled: { label: "Cancelado", cls: "bg-destructive/15 text-destructive border-destructive/30" },
    past: { label: "Pasado", cls: "bg-muted text-muted-foreground border-border" },
  };
  const v = variant[status] ?? { label: status, cls: "bg-muted text-muted-foreground border-border" };
  return (
    <Badge variant="outline" className={v.cls}>
      {v.label}
    </Badge>
  );
};

export default StatusBadge;
