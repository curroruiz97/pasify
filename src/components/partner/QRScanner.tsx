import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { haptic } from "@/lib/haptics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Camera,
  CameraOff,
  CheckCircle2,
  ChevronDown,
  Keyboard,
  RefreshCcw,
  ScanLine,
  X,
  XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import QrScanner from "qr-scanner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * QRScanner — pantalla operativa de puerta para el partner.
 *
 * Diferencias respecto a la versión anterior:
 *   - La cámara se abre AUTOMÁTICAMENTE al montar el componente (no hace
 *     falta pulsar "Abrir cámara"). Si el navegador rechaza la petición
 *     o no hay permiso, mostramos un fallback con CTA "Reintentar".
 *   - El input manual está OCULTO por defecto detrás de un toggle, para
 *     que la pantalla esté limpia (la cámara es el 95% del uso real).
 *   - Chrome editorial Pasify: eyebrow mono · headline italic · viewport
 *     16:9 con cornercitos terracota + scanline animada · pulse indicator
 *     "En vivo" · contador de escaneos de la sesión + último escaneo.
 *   - Cleanup robusto en unmount (libera la cámara siempre).
 *
 * Lógica de validación intacta: sigue llamando a la RPC server-side
 * `scan_ticket` que es atómica + auditada (ticket_scan_logs).
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

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

type CameraState = "idle" | "starting" | "live" | "denied" | "error";

const QRScanner = ({ partnerId: _partnerId }: QRScannerProps) => {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [showResultDialog, setShowResultDialog] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [sessionScans, setSessionScans] = useState(0);
  const [lastScanAt, setLastScanAt] = useState<Date | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const qrScannerRef = useRef<QrScanner | null>(null);
  // Evita doble auto-start cuando React StrictMode monta dos veces en dev.
  const startedOnceRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (qrScannerRef.current) {
      try {
        qrScannerRef.current.stop();
      } catch {
        /* noop */
      }
      qrScannerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraState("idle");
  }, []);

  const handleCloseResultDialog = () => {
    setShowResultDialog(false);
    setResult(null);
    // Reanudar escaneo si el video sigue activo
    setTimeout(() => {
      if (qrScannerRef.current && streamRef.current) {
        try {
          qrScannerRef.current.start();
        } catch (err) {
          console.error("Error resuming scanner:", err);
        }
      }
    }, 300);
  };

  const startCamera = useCallback(async () => {
    setErrMsg(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState("error");
        setErrMsg("Tu navegador no soporta acceso a cámara.");
        return;
      }
      // Limpieza por si hay un stream colgando.
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (qrScannerRef.current) {
        try {
          qrScannerRef.current.stop();
        } catch {
          /* noop */
        }
        qrScannerRef.current = null;
      }

      setCameraState("starting");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;

      // Espera al frame para enganchar el video element
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setCameraState("error");
        setErrMsg("No se pudo enganchar el preview de cámara.");
        return;
      }
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.controls = false;
      video.srcObject = stream;

      const qrScanner = new QrScanner(
        video,
        async (r) => {
          const scannedCode = r.data;
          if (!scannedCode || scannedCode.length < 4) return;
          setCode(scannedCode);
          qrScanner.stop();
          await handleScan(null, scannedCode);
        },
        {
          returnDetailedScanResult: true,
          highlightScanRegion: false,
          highlightCodeOutline: false,
          maxScansPerSecond: 5,
        }
      );
      qrScannerRef.current = qrScanner;
      await qrScanner.start();
      try {
        await video.play();
      } catch (err) {
        console.error("video.play:", err);
      }
      setCameraState("live");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "No se pudo abrir la cámara.";
      const isDenied =
        msg.toLowerCase().includes("permission") ||
        msg.toLowerCase().includes("denied") ||
        msg.toLowerCase().includes("notallowed");
      console.error("startCamera error:", err);
      setCameraState(isDenied ? "denied" : "error");
      setErrMsg(msg);
    }
    // handleScan is captured below — eslint exhaustive-deps doesn't matter,
    // we want a stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start al montar. StrictMode-safe via ref.
  useEffect(() => {
    if (startedOnceRef.current) return;
    startedOnceRef.current = true;
    void startCamera();
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScan = async (
    e: React.FormEvent | null,
    scannedCode?: string
  ) => {
    if (e) e.preventDefault();
    const codeToVerify = (scannedCode ?? code).trim();

    if (!codeToVerify) {
      toast({
        title: "Código no válido",
        description: "Introduce un código.",
        variant: "destructive",
      });
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
        setResult({
          valid: false,
          message: "Respuesta inesperada del servidor.",
        });
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
            date: row.scanned_at
              ? new Date(row.scanned_at).toLocaleString("es-ES")
              : "",
            buyer,
          },
        });
        haptic.success();
        setSessionScans((n) => n + 1);
        setLastScanAt(new Date());
        setShowResultDialog(true);
        setCode("");
        return;
      }

      // Fallos
      let msg: string;
      switch (row.result as string) {
        case "already_used":
          msg = `Ticket ya usado · ${
            row.already_used_at
              ? new Date(row.already_used_at).toLocaleString("es-ES")
              : "fecha desconocida"
          }`;
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
      setLastScanAt(new Date());
      setShowResultDialog(true);
    } catch (err) {
      console.error("Errore verifica:", err);
      setResult({ valid: false, message: "Error durante la verificación." });
      haptic.error();
      setShowResultDialog(true);
    } finally {
      setLoading(false);
    }
  };

  const isLive = cameraState === "live";
  const isStarting = cameraState === "starting";

  return (
    <div className="space-y-6">
      {/* Live status pill */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] uppercase"
          style={{
            ...mono,
            letterSpacing: "0.2em",
            background: isLive
              ? "rgba(77,184,122,0.08)"
              : isStarting
              ? "rgba(232,84,42,0.10)"
              : "rgba(255,255,255,0.04)",
            borderColor: isLive
              ? "rgba(77,184,122,0.40)"
              : isStarting
              ? "rgba(232,84,42,0.40)"
              : "rgba(244,238,226,0.10)",
            color: isLive
              ? "#4DB87A"
              : isStarting
              ? "#FF7A4D"
              : "#8A8275",
          }}
        >
          <span className="relative inline-flex h-2 w-2">
            {isLive && (
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
                style={{ background: "#4DB87A" }}
              />
            )}
            <span
              className="relative inline-flex h-2 w-2 rounded-full"
              style={{
                background: isLive
                  ? "#4DB87A"
                  : isStarting
                  ? "#FF7A4D"
                  : "#8A8275",
              }}
            />
          </span>
          {isLive
            ? "Escaneando en vivo"
            : isStarting
            ? "Activando cámara"
            : cameraState === "denied"
            ? "Cámara denegada"
            : cameraState === "error"
            ? "Cámara no disponible"
            : "Cámara apagada"}
        </div>

        {/* Stats row */}
        <div
          className="flex items-center gap-4 text-[10px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.18em" }}
        >
          <span>
            <span className="text-foreground" style={mono}>
              {String(sessionScans).padStart(2, "0")}
            </span>{" "}
            escaneos hoy
          </span>
          {lastScanAt && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>
                Último{" "}
                <span className="text-foreground" style={mono}>
                  {lastScanAt.toLocaleTimeString("es-ES", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  h
                </span>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Camera viewport */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border bg-black"
        style={{
          aspectRatio: "16/10",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.05) inset, 0 22px 50px -22px rgba(232,84,42,0.30)",
        }}
      >
        {/* Video */}
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
          autoPlay
          controls={false}
        />

        {/* Vignette overlay para enfocar la mirada en el centro */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(closest-side at 50% 50%, transparent 0%, transparent 45%, rgba(0,0,0,0.55) 100%)",
          }}
        />

        {/* Corner brackets */}
        <CornerBrackets active={isLive} />

        {/* Scan line animation cuando está live */}
        {isLive && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: "min(70%, 360px)", height: "min(70%, 360px)" }}
          >
            <div className="qr-scanline absolute left-0 right-0 h-[2px]" />
          </div>
        )}

        {/* Loading state */}
        {isStarting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-white">
            <Camera className="h-9 w-9 animate-pulse text-orange-400" />
            <div
              className="text-[11px] uppercase"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              Activando cámara…
            </div>
          </div>
        )}

        {/* Denied / Error state */}
        {(cameraState === "denied" || cameraState === "error") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/85 px-6 text-center text-white">
            <CameraOff className="h-10 w-10 text-orange-400" />
            <div className="max-w-sm">
              <div className="text-base font-semibold">
                {cameraState === "denied"
                  ? "Permiso de cámara denegado"
                  : "No se pudo abrir la cámara"}
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/70">
                {cameraState === "denied"
                  ? "Habilita el permiso de cámara en tu navegador para escanear QRs en la puerta. Mientras tanto puedes usar el código manual abajo."
                  : errMsg ?? "Comprueba que ningún otro programa esté usando la cámara."}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => void startCamera()}
              variant="outline"
              className="border-white/30 bg-white/10 text-white hover:bg-white/20"
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              Reintentar
            </Button>
          </div>
        )}

        {/* Idle state — primer render antes de auto-start */}
        {cameraState === "idle" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white">
            <Camera className="h-8 w-8 animate-pulse text-orange-400" />
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isLive ? (
            <Button
              type="button"
              onClick={stopCamera}
              variant="outline"
              className="h-10"
            >
              <X className="mr-1.5 h-4 w-4" />
              Apagar cámara
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void startCamera()}
              disabled={isStarting}
              className="h-10"
              style={{
                background:
                  "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
                color: "#fff",
              }}
            >
              <Camera className="mr-1.5 h-4 w-4" />
              {isStarting ? "Activando…" : "Abrir cámara"}
            </Button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setManualOpen((o) => !o)}
          className="group inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-orange-500/40 hover:text-foreground"
          aria-expanded={manualOpen}
        >
          <Keyboard className="h-3.5 w-3.5" />
          Código manual
          <ChevronDown
            className={`h-3 w-3 transition-transform ${manualOpen ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {/* Manual entry — colapsado por defecto */}
      {manualOpen && (
        <form
          onSubmit={(e) => handleScan(e)}
          className="space-y-3 rounded-2xl border border-border bg-card/40 p-4"
        >
          <div
            className="inline-flex items-center gap-2 text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            <Keyboard className="h-3 w-3 text-orange-500" />
            Validación manual
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Pega aquí el token del QR…"
              value={code}
              onChange={(ev) => setCode(ev.target.value)}
              disabled={loading}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={loading || !code.trim()}
              className="sm:w-auto"
            >
              <ScanLine className="mr-1.5 h-4 w-4" />
              Validar
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Útil si el QR no se lee bien (impreso borroso, pantalla rota, etc.).
          </p>
        </form>
      )}

      {/* Result Dialog */}
      <Dialog open={showResultDialog} onOpenChange={handleCloseResultDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="sr-only">
              {result?.valid ? "Válido" : "No válido"}
            </DialogTitle>
          </DialogHeader>

          {result && (
            <div
              className={`rounded-lg p-6 ${
                result.valid ? "bg-success/10" : "bg-destructive/10"
              }`}
            >
              <div className="flex flex-col items-center gap-4 text-center">
                {result.valid ? (
                  <CheckCircle2 className="h-20 w-20 text-success" />
                ) : (
                  <XCircle className="h-20 w-20 text-destructive" />
                )}
                <h3
                  className={`text-2xl font-bold ${
                    result.valid ? "text-success" : "text-destructive"
                  }`}
                >
                  {result.message}
                </h3>

                {result.valid && (
                  <div className="space-y-1.5 text-base">
                    <p>
                      <span className="font-semibold">Evento:</span>{" "}
                      {result.details.event}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {result.details.date}
                    </p>
                    <p>
                      <span className="font-semibold">Comprador:</span>{" "}
                      {result.details.buyer}
                    </p>
                  </div>
                )}

                <Button
                  onClick={handleCloseResultDialog}
                  className="mt-2 h-12 w-full text-lg"
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

// =================================================================
// Sub-components
// =================================================================

const CornerBrackets = ({ active }: { active: boolean }) => {
  const color = active ? "#FF7A4D" : "rgba(244,238,226,0.35)";
  const glow = active ? `0 0 18px ${color}aa` : "none";
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ width: "min(70%, 360px)", height: "min(70%, 360px)" }}
    >
      {/* Top-left */}
      <span
        className="absolute left-0 top-0 h-7 w-7"
        style={{
          borderTop: `3px solid ${color}`,
          borderLeft: `3px solid ${color}`,
          borderTopLeftRadius: 6,
          boxShadow: glow,
          transition: "all .3s ease",
        }}
      />
      {/* Top-right */}
      <span
        className="absolute right-0 top-0 h-7 w-7"
        style={{
          borderTop: `3px solid ${color}`,
          borderRight: `3px solid ${color}`,
          borderTopRightRadius: 6,
          boxShadow: glow,
          transition: "all .3s ease",
        }}
      />
      {/* Bottom-left */}
      <span
        className="absolute bottom-0 left-0 h-7 w-7"
        style={{
          borderBottom: `3px solid ${color}`,
          borderLeft: `3px solid ${color}`,
          borderBottomLeftRadius: 6,
          boxShadow: glow,
          transition: "all .3s ease",
        }}
      />
      {/* Bottom-right */}
      <span
        className="absolute bottom-0 right-0 h-7 w-7"
        style={{
          borderBottom: `3px solid ${color}`,
          borderRight: `3px solid ${color}`,
          borderBottomRightRadius: 6,
          boxShadow: glow,
          transition: "all .3s ease",
        }}
      />
    </div>
  );
};

export default QRScanner;
