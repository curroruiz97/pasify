import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { copyEventLink, publicEventUrl } from "@/lib/eventLinks";
import { saveOrShareFile, slugForFilename } from "@/lib/saveOrShareFile";

/**
 * QR del enlace público de un evento, para carteles y flyers. Lleva a
 * `/#/e/:id`, donde se ven los tipos de entrada y se compra.
 */
export const EventQrDialog = ({
  event,
  onOpenChange,
}: {
  event: { id: string; title: string } | null;
  onOpenChange: (open: boolean) => void;
}) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDataUrl(null);
    if (!event) return;
    let cancelled = false;
    // 1024 px y margen de 2 módulos: se imprime nítido en un A4.
    QRCode.toDataURL(publicEventUrl(event.id), { width: 1024, margin: 2, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) toast.error("No se pudo generar el QR");
      });
    return () => {
      cancelled = true;
    };
  }, [event]);

  const download = async () => {
    if (!event || !dataUrl) return;
    setSaving(true);
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await saveOrShareFile({
        filename: `pasify-qr-${slugForFilename(event.title, "evento")}.png`,
        mimeType: "image/png",
        data: blob,
        dialogTitle: "Guardar QR del evento",
      });
    } catch {
      toast.error("No se pudo guardar el QR");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={event !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>QR para cartel</DialogTitle>
          <DialogDescription>
            Quien lo escanee llega a la página de «{event?.title}», con las entradas a la venta.
          </DialogDescription>
        </DialogHeader>
        <div className="flex aspect-square w-full items-center justify-center rounded-2xl bg-white p-3">
          {dataUrl ? (
            <img src={dataUrl} alt="QR del evento" className="h-full w-full" />
          ) : (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => event && void copyEventLink(event.id)}>
            <Copy className="mr-2 h-4 w-4" />
            Copiar enlace
          </Button>
          <Button className="flex-1" disabled={!dataUrl || saving} onClick={() => void download()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Descargar PNG
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EventQrDialog;
