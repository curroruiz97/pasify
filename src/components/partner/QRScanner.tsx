import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { haptic } from "@/lib/haptics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, XCircle, ScanLine, Camera, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import QrScanner from "qr-scanner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface QRScannerProps {
  partnerId: string;
}

type ResultDetails = {
  event: string;
  date: string;
  buyer: string;
};

type ScanResult =
  | { valid: true; message: string; details: ResultDetails }
  | { valid: false; message: string };

const QRScanner = ({ partnerId }: QRScannerProps) => {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showResultDialog, setShowResultDialog] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const qrScannerRef = useRef<QrScanner | null>(null);

  const stopCamera = () => {
    if (qrScannerRef.current) {
      qrScannerRef.current.stop();
      qrScannerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScanning(false);
  };

  const handleCloseResultDialog = () => {
    setShowResultDialog(false);
    setResult(null);
    setTimeout(() => {
      if (qrScannerRef.current && scanning) {
        try {
          qrScannerRef.current.start();
        } catch (err) {
          console.error("Error resuming scanner:", err);
        }
      }
    }, 300);
  };

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast({
          title: "Cámara no disponible",
          description: "Tu navegador no soporta el acceso a la cámara.",
          variant: "destructive",
        });
        return;
      }
      stopCamera();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setScanning(true);

      setTimeout(() => {
        if (!videoRef.current) return;
        const video = videoRef.current;
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.controls = false;
        video.srcObject = stream;

        const qrScanner = new QrScanner(
          video,
          async (r) => {
            const scannedCode = r.data;
            setCode(scannedCode);
            if (scannedCode && scannedCode.length >= 4) {
              qrScanner.stop();
              await handleScan(null, scannedCode);
            }
          },
          {
            returnDetailedScanResult: true,
            highlightScanRegion: true,
            highlightCodeOutline: true,
            maxScansPerSecond: 5,
          }
        );
        qrScannerRef.current = qrScanner;
        qrScanner.start();

        video.play().catch((err) => console.error("video.play:", err));
      }, 50);
    } catch (err: any) {
      console.error("startCamera error:", err);
      toast({
        title: "Error cámara",
        description: err?.message ?? "No se pudo abrir la cámara.",
        variant: "destructive",
      });
      setScanning(false);
    }
  };

  const handleScan = async (e: React.FormEvent | null, scannedCode?: string) => {
    if (e) e.preventDefault();
    const codeToVerify = (scannedCode ?? code).trim();

    if (!codeToVerify) {
      toast({ title: "Código no válido", description: "Introduce un código.", variant: "destructive" });
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      // Llamada única a la RPC server-side `scan_ticket` que:
      //   1. Valida que el ticket existe
      //   2. Comprueba ownership (partner_id directo o org member con rol)
      //   3. Verifica estado (paid → used; used → already_used; etc.)
      //   4. Marca como usado atomicamente
      //   5. SIEMPRE inserta una fila en ticket_scan_logs con result + meta
      //
      // Esto reemplaza la lógica client-side fragil y garantiza trazabilidad
      // completa para el dashboard del partner (sección Asistentes).
      const { data: rows, error: rpcErr } = await supabase.rpc("scan_ticket", {
        _qr_token: codeToVerify,
        _device_info:
          typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : null,
      });

      if (rpcErr) {
        setResult({ valid: false, message: `Error al validar: ${rpcErr.message}` });
        haptic.error();
        setShowResultDialog(true);
        return;
      }

      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) {
        setResult({ valid: false, message: "Respuesta inesperada del servidor." });
        haptic.error();
        setShowResultDialog(true);
        return;
      }

      if (row.success) {
        const buyer =
          `${row.buyer_first_name ?? ""} ${row.buyer_last_name ?? ""}`.trim() ||
          row.buyer_email ||
          "Invitado";
        setResult({
          valid: true,
          message: "Acceso permitido",
          details: {
            event: row.event_title ?? "Evento",
            date: row.scanned_at ? new Date(row.scanned_at).toLocaleString("es-ES") : "",
            buyer,
          },
        });
        haptic.success();
        setShowResultDialog(true);
        setCode("");
        return;
      }

      // Fallos: mapeamos el enum result a mensajes accionables
      let msg: string;
      switch (row.result as string) {
        case "already_used":
          msg = `Ticket ya usado · ${row.already_used_at ? new Date(row.already_used_at).toLocaleString("es-ES") : "fecha desconocida"}`;
          break;
        case "invalid_ticket":
          msg = "Ticket no encontrado. Verifica que el QR es válido.";
          break;
        case "wrong_event":
          msg = "Este ticket no es para tu evento.";
          break;
        case "not_paid":
          msg = "Ticket sin pago confirmado. Acceso denegado.";
          break;
        case "forbidden":
          msg = "No tienes permisos para escanear este ticket.";
          break;
        default:
          msg = `Ticket no válido (${row.result})`;
      }
      setResult({ valid: false, message: msg });
      haptic.error();
      setShowResultDialog(true);
    } catch (err: any) {
      console.error("Errore verifica:", err);
      setResult({ valid: false, message: "Error durante la verificación." });
      haptic.error();
      setShowResultDialog(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="ios-card p-6">
        <div className="text-center mb-6">
          <ScanLine className="w-16 h-16 mx-auto mb-4 text-primary animate-pulse" />
          <h2 className="text-xl font-bold mb-2">Escáner de tickets</h2>
          <p className="text-muted-foreground text-sm">
            Escanea el QR del cliente en la puerta para validar su entrada.
          </p>
        </div>

        {scanning ? (
          <div className="space-y-4">
            <div className="relative rounded-lg overflow-hidden bg-black">
              <video
                ref={videoRef}
                className="w-full h-[400px] object-cover"
                playsInline
                muted
                autoPlay
                controls={false}
                style={{ backgroundColor: "#000", width: "100%", height: "400px", objectFit: "cover" }}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="border-4 border-white/50 w-64 h-64 rounded-lg" />
              </div>
            </div>

            <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 text-sm">
              <p className="text-center text-primary">
                💡 <strong>Tip:</strong> mantén el QR firme dentro del recuadro.
              </p>
            </div>

            <Button onClick={stopCamera} variant="outline" className="w-full" size="lg">
              <X className="w-4 h-4 mr-2" />
              Cerrar cámara
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Button
              onClick={startCamera}
              className="w-full mb-4 h-14 bg-gradient-to-br from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
              size="lg"
              type="button"
            >
              <Camera className="w-5 h-5 mr-2" />
              Abrir cámara
            </Button>
          </div>
        )}

        {/* Manual input */}
        <form onSubmit={(e) => handleScan(e)} className="space-y-4">
          <div className="relative my-4 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>O introduce código manual</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <Input
            placeholder="Pega aquí el token del QR..."
            value={code}
            onChange={(ev) => setCode(ev.target.value)}
            disabled={loading}
          />
          <Button type="submit" className="w-full" disabled={loading || !code.trim()}>
            Validar
          </Button>
        </form>
      </div>

      {/* Result Dialog */}
      <Dialog open={showResultDialog} onOpenChange={handleCloseResultDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="sr-only">{result?.valid ? "Válido" : "No válido"}</DialogTitle>
          </DialogHeader>

          {result && (
            <div className={`p-6 rounded-lg ${result.valid ? "bg-success/10" : "bg-destructive/10"}`}>
              <div className="flex flex-col items-center gap-4 text-center">
                {result.valid ? (
                  <CheckCircle2 className="w-20 h-20 text-success" />
                ) : (
                  <XCircle className="w-20 h-20 text-destructive" />
                )}
                <h3 className={`text-2xl font-bold ${result.valid ? "text-success" : "text-destructive"}`}>
                  {result.message}
                </h3>

                {result.valid && (
                  <div className="space-y-1.5 text-base">
                    <p>
                      <span className="font-semibold">Evento:</span> {result.details.event}
                    </p>
                    <p className="text-sm text-muted-foreground">{result.details.date}</p>
                    <p>
                      <span className="font-semibold">Comprador:</span> {result.details.buyer}
                    </p>
                  </div>
                )}

                <Button
                  onClick={handleCloseResultDialog}
                  className="w-full mt-2 h-12 text-lg"
                  variant={result.valid ? "default" : "destructive"}
                >
                  Cerrar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default QRScanner;
