import { useEffect, useState } from "react";
import { Ban, Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { orgSuspendida, type AdminPartnerOrg } from "./adminQueries";
import { cambiarSuspension } from "./adminActions";
import { fecha } from "./adminFormat";
import { Chip } from "./AdminUi";

/* ============================================================================
   Suspender y reactivar un local (B5-3, D-8) desde Locales.

   Suspender es de la organización (admin_set_org_suspension, de la
   migración del checkout): bloquea vender y publicar, oculta sus eventos al
   público y avisa al dueño. La puerta, los reembolsos y el panel del local
   siguen funcionando, y no se le liquida hasta que se reactive.
   «Rechazar» (account_status) no para las ventas de un local que ya vende.
   ============================================================================ */

/** Estado de la organización en la fila de Locales: solo si no está activa. */
export const OrgEstado = ({ org, varias }: { org: AdminPartnerOrg; varias: boolean }) => {
  if (orgSuspendida(org)) {
    return (
      <div className="mt-1 max-w-[16rem] text-xs text-muted-foreground">
        <Chip color="#E5484D">Suspendido</Chip>
        <div className="mt-1">
          {varias ? `${org.name}: ` : ""}
          {org.suspended_at ? `desde ${fecha(org.suspended_at)}` : "suspendido"}
          {org.suspended_reason ? ` · ${org.suspended_reason}` : ""}
        </div>
      </div>
    );
  }
  if (org.status === "closed") {
    return (
      <div className="mt-1 text-xs text-muted-foreground">
        <Chip color="#8A8275">Cerrado</Chip>
        {varias && <span className="ml-1">{org.name}</span>}
      </div>
    );
  }
  return null;
};

export type SuspensionTarget = { org: AdminPartnerOrg; suspender: boolean };

const MOTIVO_MINIMO = 5;

export const OrgSuspensionDialog = ({
  target,
  onClose,
  onDone,
}: {
  target: SuspensionTarget | null;
  onClose: () => void;
  onDone: () => void;
}) => {
  const { toast } = useToast();
  const [motivo, setMotivo] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const suspender = target?.suspender ?? true;
  const limpio = motivo.trim();
  const valido = !suspender || limpio.length >= MOTIVO_MINIMO;

  useEffect(() => {
    if (target) setMotivo("");
  }, [target]);

  const cerrar = () => {
    if (!trabajando) onClose();
  };

  const confirmar = async () => {
    if (!target || !valido) return;
    setTrabajando(true);
    try {
      const aviso = await cambiarSuspension(target.org.org_id, suspender, suspender ? limpio : null);
      toast({ title: aviso.titulo, description: aviso.descripcion, variant: aviso.ok ? undefined : "destructive" });
      if (aviso.ok) {
        onDone();
        onClose();
      }
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {suspender ? "Suspender" : "Reactivar"} «{target?.org.name ?? ""}»
          </DialogTitle>
          <DialogDescription>
            {suspender
              ? "Deja de vender y de publicar, y sus eventos dejan de verse en Pasify. La puerta, los reembolsos y su panel siguen funcionando, y no se le liquida mientras dure. Le avisaremos con el motivo."
              : "Vuelve a poder vender y publicar, y sus eventos publicados vuelven a verse."}
          </DialogDescription>
        </DialogHeader>
        {suspender && (
          <div className="space-y-1.5">
            <Label htmlFor="suspension-motivo" className="text-xs">
              Motivo (lo verá el local)
            </Label>
            <Textarea
              id="suspension-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por ejemplo: ventas sin licencia de apertura en vigor."
              rows={3}
              maxLength={500}
              disabled={trabajando}
              autoFocus
            />
            {!valido && motivo.length > 0 && (
              <p className="text-xs text-muted-foreground">Escribe al menos {MOTIVO_MINIMO} caracteres.</p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={cerrar} disabled={trabajando}>
            Volver
          </Button>
          <Button
            variant={suspender ? "destructive" : "default"}
            disabled={!valido || trabajando}
            onClick={() => void confirmar()}
          >
            {trabajando ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : suspender ? (
              <Ban className="mr-2 h-4 w-4" />
            ) : (
              <PlayCircle className="mr-2 h-4 w-4" />
            )}
            {suspender ? "Suspender" : "Reactivar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
