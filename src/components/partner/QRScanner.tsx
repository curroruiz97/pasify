import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { Camera as CameraPlugin } from "@capacitor/camera";
import QrScanner from "qr-scanner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  ChevronDown,
  Keyboard,
  Loader2,
  RefreshCcw,
  ScanLine,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { haptic } from "@/lib/haptics";
import { withTimeout, TimeoutError } from "@/lib/withTimeout";
import { appPlatform } from "@/lib/platform";
import { eventPhase, listEventChoices, pickActiveEvent } from "@/lib/pickActiveEvent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * QRScanner — control de puerta del local, contra `scan_ticket` v2.
 *
 *   - Evento en puerta arriba: por defecto el de ahora (pickActiveEvent) y
 *     se envía como `_event_id`. Una entrada de otro evento o fuera de su
 *     horario sale en rojo con el evento real; quien gestiona el evento puede
 *     "Dar entrada igualmente" con un motivo (queda auditado en servidor).
 *   - Resultado a pantalla completa: verde (se cierra solo a ~1,5 s) o rojo
 *     (hay que tocar para seguir), con el tipo de entrada, pitido y vibración.
 *   - Entre lecturas se usa pause()/start() de qr-scanner, sin destruir el
 *     escáner (ojo: pause() suelta el stream a los 300 ms y start() lo vuelve
 *     a pedir; así la cámara no queda encendida con un resultado rojo en
 *     pantalla). destroy() solo al apagar la cámara o salir.
 *   - Timeout de 6 s en la RPC: "Sin conexión, reintenta", nunca un verde.
 *   - Permiso de cámara: en la app se pide con @capacitor/camera y, si está
 *     denegado, se explica dónde activarlo en Ajustes.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

const SCAN_TIMEOUT_MS = 6_000;
const OK_AUTO_CLOSE_MS = 1_500;
/** Tras cerrar un resultado, el mismo QR delante de la cámara se ignora este rato. */
const SAME_CODE_COOLDOWN_MS = 2_500;
/** already_used tan reciente que puede ser el propio reintento tras un corte. */
const RECENT_USE_MS = 2 * 60_000;

export interface ScannerEvent {
  id: string;
  title: string;
  date_start: string;
  date_end?: string | null;
  status: string;
}

interface QRScannerProps {
  /** Eventos del local (los mismos del panel). */
  events: ScannerEvent[];
  /**
   * Estado de la carga de eventos del panel. El escáner no espera a la lista
   * (la puerta no se para): sin eventos valida cada entrada contra el suyo.
   */
  eventsState?: "loading" | "error" | "ready";
}

type ScanResultCode =
  | "success"
  | "already_used"
  | "invalid_ticket"
  | "wrong_event"
  | "not_paid"
  | "forbidden"
  | "outside_window"
  | "event_cancelled";

/** Fila de scan_ticket v2. Con `forbidden` todo lo del evento/comprador llega null. */
interface ScanRow {
  success: boolean;
  result: ScanResultCode | string;
  ticket_id: string | null;
  event_id: string | null;
  event_title: string | null;
  buyer_first_name: string | null;
  buyer_last_name: string | null;
  /** Solo para quien gestiona el evento; null para el rol de puerta. */
  buyer_email: string | null;
  tier_name: string | null;
  scanned_at: string | null;
  already_used_at: string | null;
  /** En wrong_event/outside_window, la fecha del evento REAL de la entrada. */
  event_date_start: string | null;
  forced: boolean | null;
}

interface ScanArgs {
  _qr_token: string;
  _device_info: string | null;
  _event_id?: string;
  _force?: boolean;
  _force_reason?: string;
}

type ForceRequest = { reason: string };

type Outcome =
  | { kind: "ticket"; row: ScanRow; token: string; forceAttempted: boolean }
  | { kind: "offline"; token: string; force?: ForceRequest }
  | { kind: "error"; token: string; message: string; force?: ForceRequest }
  | { kind: "not_pasify" };

type CameraState = "idle" | "starting" | "live" | "denied" | "error";

interface ScanByCodeArgs {
  _code: string;
  _event_id: string;
  _device_info: string | null;
  _force?: boolean;
  _force_reason?: string;
}

type ScanRpc = {
  rpc: (
    name: "scan_ticket" | "scan_ticket_by_code",
    args: ScanArgs | ScanByCodeArgs
  ) => PromiseLike<{ data: ScanRow[] | ScanRow | null; error: { message: string } | null }>;
};

// Cast hasta que se regeneren los types con la firma v2 de scan_ticket.
const scanTicketRpc = (args: ScanArgs) =>
  (supabase as unknown as ScanRpc).rpc("scan_ticket", args);
const scanTicketByCodeRpc = (args: ScanByCodeArgs) =>
  (supabase as unknown as ScanRpc).rpc("scan_ticket_by_code", args);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKET_URL_RE = /\/t\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;
/** Lo que ve el cliente bajo su QR: los 8 primeros caracteres del código. */
const SHORT_CODE_RE = /^[0-9a-f]{8,31}$/i;
const CODE_PREFIX = "code:";

/** El QR de una entrada es su qr_token (UUID); se acepta también el enlace /t/<token>. */
const extractTicketToken = (raw: string): string | null => {
  const text = raw.trim();
  if (UUID_RE.test(text)) return text.toLowerCase();
  const match = TICKET_URL_RE.exec(text);
  return match ? match[1].toLowerCase() : null;
};

/** Código corto tecleado a mano ("85323059" o "8532-3059"): se busca en el servidor. */
const extractShortCode = (raw: string): string | null => {
  const hex = raw.trim().replace(/[\s-]/g, "");
  return SHORT_CODE_RE.test(hex) ? hex.toLowerCase() : null;
};

const NETWORK_ERROR_RE =
  /failed to fetch|load failed|networkerror|network request failed|fetch failed|network connection was lost|internet connection appears to be offline/i;

const looksOffline = (message: string) =>
  NETWORK_ERROR_RE.test(message) || (typeof navigator !== "undefined" && navigator.onLine === false);

const deviceInfo = () =>
  typeof navigator !== "undefined" ? `${appPlatform()} · ${navigator.userAgent}`.slice(0, 200) : null;

const buyerName = (row: ScanRow) =>
  `${row.buyer_first_name ?? ""} ${row.buyer_last_name ?? ""}`.trim() || row.buyer_email || null;

const eventDateLabel = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : format(d, "EEEE d MMM · HH:mm", { locale: es });
};

const dayTimeLabel = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : format(d, "d MMM · HH:mm", { locale: es });
};

// ----------------------------------------------------------------------------
// Permiso de cámara
// ----------------------------------------------------------------------------

/** En la app nativa: consulta y, si hace falta, pide el permiso del sistema. */
const ensureNativeCameraPermission = async (): Promise<"granted" | "denied"> => {
  try {
    const current = await CameraPlugin.checkPermissions();
    if (current.camera === "granted" || current.camera === "limited") return "granted";
    if (current.camera === "denied") return "denied";
    const requested = await CameraPlugin.requestPermissions({ permissions: ["camera"] });
    return requested.camera === "granted" || requested.camera === "limited" ? "granted" : "denied";
  } catch {
    // Sin plugin (o fallo del puente): que decida getUserMedia.
    return "granted";
  }
};

const cameraErrorName = (err: unknown) =>
  typeof err === "object" && err !== null && "name" in err ? String((err as { name: unknown }).name) : "";

const isPermissionError = (err: unknown) =>
  ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(cameraErrorName(err));

const describeCameraError = (err: unknown): string => {
  const name = cameraErrorName(err);
  if (name === "NotFoundError" || name === "OverconstrainedError" || err === "Camera not found.") {
    return "No encontramos ninguna cámara disponible en este dispositivo.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "La cámara está ocupada por otra aplicación. Ciérrala y vuelve a intentarlo.";
  }
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "No se pudo abrir la cámara.";
};

// ----------------------------------------------------------------------------
// Pitido (WebAudio)
// ----------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  return audioCtx;
};

/** iOS solo deja sonar el audio tras un gesto: se desbloquea en el primer toque. */
const unlockAudio = () => {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
};

/** Verde: un pitido agudo corto. Rojo: dos graves. */
const playBeep = (ok: boolean) => {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const tones = ok
      ? [{ freq: 1320, at: 0, dur: 0.12 }]
      : [
          { freq: 240, at: 0, dur: 0.16 },
          { freq: 240, at: 0.22, dur: 0.16 },
        ];
    const t0 = ctx.currentTime + 0.01;
    for (const tone of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = ok ? "sine" : "square";
      osc.frequency.value = tone.freq;
      const start = t0 + tone.at;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(ok ? 0.3 : 0.18, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + tone.dur + 0.02);
    }
  } catch {
    /* sin audio: queda la vibración y el color */
  }
};

// ----------------------------------------------------------------------------
// Componente
// ----------------------------------------------------------------------------

const QRScanner = ({ events, eventsState = "ready" }: QRScannerProps) => {
  // ---- Evento en puerta ------------------------------------------------------
  const selectable = useMemo(() => listEventChoices(events), [events]);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    () => pickActiveEvent(events)?.id ?? null
  );

  useEffect(() => {
    if (selectedEventId && selectable.some((e) => e.id === selectedEventId)) return;
    const next = pickActiveEvent(events)?.id ?? selectable[0]?.id ?? null;
    if (next !== selectedEventId) setSelectedEventId(next);
  }, [events, selectable, selectedEventId]);

  const selectedEvent = selectable.find((e) => e.id === selectedEventId) ?? null;

  // ---- Cámara ----------------------------------------------------------------
  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const startAttemptRef = useRef(0);
  const mountedRef = useRef(false);

  // ---- Lecturas --------------------------------------------------------------
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [validating, setValidating] = useState(false);
  const [sessionOk, setSessionOk] = useState(0);
  const [lastScanAt, setLastScanAt] = useState<Date | null>(null);
  /** RPC en vuelo o resultado en pantalla: las lecturas de la cámara se ignoran. */
  const busyRef = useRef(false);
  const lastRawRef = useRef<string | null>(null);
  const cooldownUntilRef = useRef(0);
  const autoCloseRef = useRef<number | null>(null);
  const onDecodeRef = useRef<(raw: string) => void>(() => undefined);

  // ---- Entrada manual y "dar entrada igualmente" -----------------------------
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [forceOpen, setForceOpen] = useState(false);
  const [forceReason, setForceReason] = useState("");

  const releaseCamera = useCallback(() => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try {
        // Suelta el stream ya, sin los 300 ms de gracia de pause().
        void scanner.pause(true).catch(() => undefined);
      } catch {
        /* noop */
      }
      try {
        scanner.destroy();
      } catch {
        /* noop */
      }
    }
    const video = videoRef.current;
    if (video) {
      const stream = video.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    const attempt = ++startAttemptRef.current;
    const stale = () => !mountedRef.current || attempt !== startAttemptRef.current;
    releaseCamera();
    setCameraError(null);
    setCameraState("starting");

    if (Capacitor.isNativePlatform()) {
      const permission = await ensureNativeCameraPermission();
      if (stale()) return;
      if (permission === "denied") {
        setCameraState("denied");
        return;
      }
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      setCameraError("Este dispositivo no permite usar la cámara desde aquí. Puedes validar con el código manual.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    } catch (err) {
      if (stale()) return;
      console.warn("[QRScanner] getUserMedia:", err);
      setCameraState(isPermissionError(err) ? "denied" : "error");
      setCameraError(describeCameraError(err));
      return;
    }
    if (stale()) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const video = videoRef.current;
    if (!video) {
      stream.getTracks().forEach((t) => t.stop());
      setCameraState("error");
      setCameraError("No se pudo mostrar la imagen de la cámara.");
      return;
    }
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    const scanner = new QrScanner(video, (result) => onDecodeRef.current(result.data), {
      returnDetailedScanResult: true,
      highlightScanRegion: false,
      highlightCodeOutline: false,
      maxScansPerSecond: 5,
      preferredCamera: "environment",
    });
    scannerRef.current = scanner;
    try {
      await scanner.start();
      if (stale()) return;
      setCameraState("live");
      // Si hay un resultado en pantalla, el escáner espera en pausa.
      if (busyRef.current) void scanner.pause().catch(() => undefined);
    } catch (err) {
      if (stale()) return;
      console.warn("[QRScanner] scanner.start:", err);
      releaseCamera();
      setCameraState(isPermissionError(err) ? "denied" : "error");
      setCameraError(describeCameraError(err));
    }
  }, [releaseCamera]);

  /** Invalida un arranque de cámara en vuelo (sus awaits verán que ya no toca). */
  const cancelPendingStart = useCallback(() => {
    startAttemptRef.current += 1;
  }, []);

  const stopCamera = useCallback(() => {
    cancelPendingStart();
    releaseCamera();
    setCameraState("idle");
    setCameraError(null);
  }, [cancelPendingStart, releaseCamera]);

  const pauseScanner = useCallback(() => {
    const scanner = scannerRef.current;
    if (scanner) void scanner.pause().catch(() => undefined);
  }, []);

  const resumeScanner = useCallback(() => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    scanner.start().catch((err: unknown) => {
      if (!mountedRef.current || scannerRef.current !== scanner) return;
      releaseCamera();
      setCameraState(isPermissionError(err) ? "denied" : "error");
      setCameraError(describeCameraError(err));
    });
  }, [releaseCamera]);

  const clearAutoClose = useCallback(() => {
    if (autoCloseRef.current !== null) {
      window.clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
  }, []);

  const dismissOutcome = useCallback(() => {
    clearAutoClose();
    setOutcome(null);
    setForceOpen(false);
    setForceReason("");
    cooldownUntilRef.current = Date.now() + SAME_CODE_COOLDOWN_MS;
    busyRef.current = false;
    resumeScanner();
  }, [clearAutoClose, resumeScanner]);

  const presentOutcome = useCallback(
    (next: Outcome) => {
      setOutcome(next);
      setForceOpen(false);
      setForceReason("");
      const ok = next.kind === "ticket" && next.row.success;
      if (ok) void haptic.success();
      else void haptic.error();
      playBeep(ok);
      clearAutoClose();
      if (ok) autoCloseRef.current = window.setTimeout(dismissOutcome, OK_AUTO_CLOSE_MS);
    },
    [clearAutoClose, dismissOutcome]
  );

  // `token` es el qr_token leído o, si se tecleó el código corto, "code:<hex>".
  const runScan = async (token: string, force?: ForceRequest) => {
    const byCode = token.startsWith(CODE_PREFIX);
    if (byCode && !selectedEventId) {
      presentOutcome({ kind: "error", token, message: "Elige arriba el evento para validar por código.", force });
      return;
    }
    setValidating(true);
    const request = byCode
      ? scanTicketByCodeRpc({
          _code: token.slice(CODE_PREFIX.length),
          _event_id: selectedEventId as string,
          _device_info: deviceInfo(),
          ...(force ? { _force: true, _force_reason: force.reason } : {}),
        })
      : scanTicketRpc({
          _qr_token: token,
          _device_info: deviceInfo(),
          ...(selectedEventId ? { _event_id: selectedEventId } : {}),
          ...(force ? { _force: true, _force_reason: force.reason } : {}),
        });
    try {
      const { data, error } = await withTimeout(
        Promise.resolve(request),
        SCAN_TIMEOUT_MS,
        byCode ? "scan_ticket_by_code" : "scan_ticket"
      );
      if (!mountedRef.current) return;
      if (error) {
        presentOutcome(
          looksOffline(error.message)
            ? { kind: "offline", token, force }
            : { kind: "error", token, message: error.message, force }
        );
        return;
      }
      const row = (Array.isArray(data) ? data[0] : data) ?? null;
      if (!row) {
        presentOutcome({ kind: "error", token, message: "El servidor no ha devuelto resultado.", force });
        return;
      }
      if (row.success) setSessionOk((n) => n + 1);
      setLastScanAt(new Date());
      presentOutcome({ kind: "ticket", row, token, forceAttempted: !!force });
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      presentOutcome(
        err instanceof TimeoutError || looksOffline(message)
          ? { kind: "offline", token, force }
          : { kind: "error", token, message, force }
      );
    } finally {
      if (mountedRef.current) setValidating(false);
    }
  };

  // Lectura de la cámara. Se guarda en un ref para que qr-scanner (creado una
  // vez) llame siempre a la versión con el evento elegido ahora.
  const handleDecoded = (raw: string) => {
    if (busyRef.current) return;
    if (raw === lastRawRef.current && Date.now() < cooldownUntilRef.current) return;
    lastRawRef.current = raw;
    busyRef.current = true;
    pauseScanner();
    const token = extractTicketToken(raw);
    if (!token) {
      presentOutcome({ kind: "not_pasify" });
      return;
    }
    void runScan(token);
  };

  useEffect(() => {
    onDecodeRef.current = handleDecoded;
  });

  // Arranque automático al montar; al desmontar se destruye el escáner.
  useEffect(() => {
    mountedRef.current = true;
    void startCamera();
    return () => {
      mountedRef.current = false;
      cancelPendingStart();
      clearAutoClose();
      releaseCamera();
    };
  }, [startCamera, cancelPendingStart, clearAutoClose, releaseCamera]);

  // Sin permiso: al volver de Ajustes (la app pasa a primer plano) se reintenta sola.
  useEffect(() => {
    if (cameraState !== "denied") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void startCamera();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [cameraState, startCamera]);

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    const shortCode = extractTicketToken(manualCode) ? null : extractShortCode(manualCode);
    const token = extractTicketToken(manualCode) ?? (shortCode ? `${CODE_PREFIX}${shortCode}` : null);
    if (!token) {
      setManualError(
        "Formato no válido. Escribe el código que el cliente ve bajo su QR (8 caracteres, p. ej. 1b4e28ba) o el código completo."
      );
      return;
    }
    setManualError(null);
    busyRef.current = true;
    lastRawRef.current = null;
    pauseScanner();
    setManualCode("");
    void runScan(token);
  };

  const submitForce = (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcome || outcome.kind !== "ticket" || validating) return;
    const reason = forceReason.trim();
    if (reason.length < 3) return;
    void runScan(outcome.token, { reason });
  };

  const retry = () => {
    if (!outcome || validating) return;
    if (outcome.kind === "offline" || outcome.kind === "error") {
      void runScan(outcome.token, outcome.force);
    }
  };

  const isLive = cameraState === "live";
  const isStarting = cameraState === "starting";
  const platform = appPlatform();
  const deniedHelp =
    platform === "ios"
      ? "Actívala en Ajustes › Pasify › Cámara y vuelve aquí."
      : platform === "android"
      ? "Actívala en Ajustes › Aplicaciones › Pasify › Permisos › Cámara y vuelve aquí."
      : "El navegador ha bloqueado la cámara para esta web: permítela desde el icono junto a la dirección (o en los ajustes del sitio) y pulsa Reintentar.";

  return (
    <div className="space-y-6" onPointerDown={unlockAudio}>
      {/* Evento en puerta */}
      <div className="rounded-2xl border border-border bg-card p-3 sm:p-4">
        <div
          className="mb-1.5 text-[10px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          Evento en puerta
        </div>
        {selectable.length > 0 ? (
          <Select value={selectedEventId ?? ""} onValueChange={(v) => setSelectedEventId(v || null)}>
            <SelectTrigger aria-label="Evento en puerta" className="h-11 w-full">
              <SelectValue placeholder="Elige el evento" />
            </SelectTrigger>
            <SelectContent>
              {selectable.map((e) => {
                const phase = eventPhase(e);
                return (
                  <SelectItem key={e.id} value={e.id}>
                    {e.title} · {format(new Date(e.date_start), "EEE d MMM HH:mm", { locale: es })}
                    {phase === "live" ? " · en curso" : phase === "ended" ? " · terminado" : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        ) : eventsState === "loading" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Cargando tus eventos…
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {eventsState === "error"
              ? "No pudimos cargar tus eventos."
              : "No tienes eventos en curso ni en los próximos 7 días."}{" "}
            Cada entrada se validará contra su propio evento y su horario.
          </p>
        )}
        {selectedEvent && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Las entradas de otros eventos saldrán en rojo con el evento al que pertenecen.
          </p>
        )}
      </div>

      {/* Estado de la cámara + contador de la sesión */}
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
            color: isLive ? "#4DB87A" : isStarting ? "#FF7A4D" : "#8A8275",
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
              style={{ background: isLive ? "#4DB87A" : isStarting ? "#FF7A4D" : "#8A8275" }}
            />
          </span>
          {isLive
            ? "Escaneando en vivo"
            : isStarting
            ? "Activando cámara"
            : cameraState === "denied"
            ? "Cámara sin permiso"
            : cameraState === "error"
            ? "Cámara no disponible"
            : "Cámara apagada"}
        </div>

        <div
          className="flex items-center gap-4 text-[10px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.18em" }}
        >
          <span>
            <span className="text-foreground" style={mono}>
              {String(sessionOk).padStart(2, "0")}
            </span>{" "}
            validadas en esta sesión
          </span>
          {lastScanAt && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>
                Última{" "}
                <span className="text-foreground" style={mono}>
                  {lastScanAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Visor de la cámara */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border bg-black"
        style={{
          aspectRatio: "16/10",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.05) inset, 0 22px 50px -22px rgba(232,84,42,0.30)",
        }}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
          autoPlay
          controls={false}
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(closest-side at 50% 50%, transparent 0%, transparent 45%, rgba(0,0,0,0.55) 100%)",
          }}
        />

        <CornerBrackets active={isLive} />

        {isLive && !validating && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: "min(70%, 360px)", height: "min(70%, 360px)" }}
          >
            <div className="qr-scanline absolute left-0 right-0 h-[2px]" />
          </div>
        )}

        {validating && !outcome && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-white">
            <Loader2 className="h-9 w-9 animate-spin text-orange-400" />
            <div className="text-[11px] uppercase" style={{ ...mono, letterSpacing: "0.22em" }}>
              Validando entrada…
            </div>
          </div>
        )}

        {isStarting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-white">
            <Camera className="h-9 w-9 animate-pulse text-orange-400" />
            <div className="text-[11px] uppercase" style={{ ...mono, letterSpacing: "0.22em" }}>
              Activando cámara…
            </div>
          </div>
        )}

        {(cameraState === "denied" || cameraState === "error") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-black/85 px-6 py-4 text-center text-white">
            <CameraOff className="h-10 w-10 shrink-0 text-orange-400" />
            <div className="max-w-sm">
              <div className="text-base font-semibold">
                {cameraState === "denied" ? "Pasify no tiene permiso para usar la cámara" : "No se pudo abrir la cámara"}
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/75">
                {cameraState === "denied"
                  ? `La cámara es necesaria para leer los QR de las entradas. ${deniedHelp} Mientras tanto puedes validar con el código manual.`
                  : cameraError ?? "Comprueba que ninguna otra aplicación esté usando la cámara."}
              </p>
              {cameraState === "denied" && platform === "web" && cameraError && (
                <p className="mt-1 text-[11px] text-white/50">Mensaje del navegador: {cameraError}</p>
              )}
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

        {cameraState === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 text-white">
            <CameraOff className="h-8 w-8 text-white/60" />
            <div className="text-[11px] uppercase text-white/70" style={{ ...mono, letterSpacing: "0.22em" }}>
              Cámara apagada
            </div>
          </div>
        )}
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isLive ? (
            <Button type="button" onClick={stopCamera} variant="outline" className="h-10">
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
                background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
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
          <ChevronDown className={`h-3 w-3 transition-transform ${manualOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Entrada manual */}
      {manualOpen && (
        <form onSubmit={submitManual} className="space-y-3 rounded-2xl border border-border bg-card/40 p-4" noValidate>
          <div
            className="inline-flex items-center gap-2 text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            <Keyboard className="h-3 w-3 text-orange-500" />
            Validación manual
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Código bajo el QR (8 caracteres)"
              value={manualCode}
              onChange={(ev) => {
                setManualCode(ev.target.value);
                if (manualError) setManualError(null);
              }}
              disabled={validating}
              className="flex-1"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Código de la entrada"
              aria-invalid={manualError ? true : undefined}
            />
            <Button type="submit" disabled={validating || !manualCode.trim()} className="sm:w-auto">
              <ScanLine className="mr-1.5 h-4 w-4" />
              Validar
            </Button>
          </div>
          {manualError ? (
            <p className="text-[12px] text-destructive" role="alert">
              {manualError}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Para cuando el QR no se lee (pantalla rota, brillo bajo…).
            </p>
          )}
        </form>
      )}

      {outcome && (
        <ResultOverlay
          outcome={outcome}
          selectedEvent={selectedEvent}
          validating={validating}
          forceOpen={forceOpen}
          forceReason={forceReason}
          onForceReasonChange={setForceReason}
          onOpenForce={() => setForceOpen(true)}
          onCancelForce={() => {
            setForceOpen(false);
            setForceReason("");
          }}
          onSubmitForce={submitForce}
          onRetry={retry}
          onDismiss={dismissOutcome}
        />
      )}
    </div>
  );
};

// ----------------------------------------------------------------------------
// Resultado a pantalla completa
// ----------------------------------------------------------------------------

interface OutcomeView {
  tone: "ok" | "bad" | "offline";
  title: string;
  tier: string | null;
  person: string | null;
  lines: string[];
  canForce: boolean;
  canRetry: boolean;
}

const describeOutcome = (outcome: Outcome, selectedEvent: ScannerEvent | null): OutcomeView => {
  if (outcome.kind === "not_pasify") {
    return {
      tone: "bad",
      title: "QR no válido",
      tier: null,
      person: null,
      lines: ["Este código no es una entrada de Pasify."],
      canForce: false,
      canRetry: false,
    };
  }
  if (outcome.kind === "offline") {
    return {
      tone: "offline",
      title: "Sin conexión, reintenta",
      tier: null,
      person: null,
      lines: ["No sabemos si la entrada es válida: no dejes pasar hasta confirmarlo."],
      canForce: false,
      canRetry: true,
    };
  }
  if (outcome.kind === "error") {
    return {
      tone: "bad",
      title: "No se pudo validar",
      tier: null,
      person: null,
      lines: [outcome.message],
      canForce: false,
      canRetry: true,
    };
  }

  const { row, forceAttempted } = outcome;
  const tier = row.tier_name;
  const person = buyerName(row);
  const realEvent = [row.event_title ? `«${row.event_title}»` : null, eventDateLabel(row.event_date_start)]
    .filter(Boolean)
    .join(" · ");

  if (row.success) {
    return {
      tone: "ok",
      title: row.forced ? "Entrada forzada" : "Entrada válida",
      tier,
      person,
      lines: [
        row.event_title && row.event_id !== selectedEvent?.id ? `Evento: ${row.event_title}` : null,
        row.forced ? "Se ha registrado quién la ha dado y el motivo." : null,
      ].filter((l): l is string => !!l),
      canForce: false,
      canRetry: false,
    };
  }

  const forceRejected = forceAttempted && (row.result === "wrong_event" || row.result === "outside_window");
  const forceRejectedLine =
    "No se ha podido dar entrada: solo quien gestiona el evento (propietario, admin o manager) puede hacerlo, y con motivo.";

  switch (row.result) {
    case "already_used": {
      const usedAt = row.already_used_at ? new Date(row.already_used_at) : null;
      const agoMs = usedAt ? Date.now() - usedAt.getTime() : null;
      const lines = [usedAt ? `Entró el ${dayTimeLabel(row.already_used_at)}.` : "Ya se validó antes."];
      if (agoMs !== null && agoMs >= 0 && agoMs < RECENT_USE_MS) {
        lines.push(
          `Hace ${Math.max(1, Math.round(agoMs / 1000))} s. Si acabas de reintentar tras un fallo de conexión, era tu propio escaneo: la entrada ya está validada.`
        );
      }
      return { tone: "bad", title: "Entrada ya usada", tier, person, lines, canForce: false, canRetry: false };
    }
    case "invalid_ticket":
      return {
        tone: "bad",
        title: "Entrada no encontrada",
        tier: null,
        person: null,
        lines: ["Este QR no corresponde a ninguna entrada de Pasify."],
        canForce: false,
        canRetry: false,
      };
    case "wrong_event":
      return {
        tone: "bad",
        title: "Es de otro evento",
        tier,
        person,
        lines: [
          realEvent ? `Esta entrada es para ${realEvent}.` : "Esta entrada es de otro evento.",
          forceRejected ? forceRejectedLine : null,
        ].filter((l): l is string => !!l),
        canForce: !forceRejected,
        canRetry: false,
      };
    case "outside_window":
      return {
        tone: "bad",
        title: "Fuera de horario",
        tier,
        person,
        lines: [
          realEvent ? `Esta entrada es para ${realEvent}.` : null,
          "Ahora no está dentro del horario de su evento.",
          forceRejected ? forceRejectedLine : null,
        ].filter((l): l is string => !!l),
        canForce: !forceRejected,
        canRetry: false,
      };
    case "event_cancelled":
      return {
        tone: "bad",
        title: "Evento cancelado",
        tier,
        person,
        lines: [
          row.event_title ? `«${row.event_title}» está cancelado: la entrada no es válida.` : "El evento de esta entrada está cancelado.",
        ],
        canForce: false,
        canRetry: false,
      };
    case "not_paid":
      return {
        tone: "bad",
        title: "Entrada sin pagar",
        tier,
        person,
        lines: ["El pago de esta entrada no está confirmado."],
        canForce: false,
        canRetry: false,
      };
    case "forbidden":
      return {
        tone: "bad",
        title: "Sin permiso",
        tier: null,
        person: null,
        lines: ["Tu cuenta no puede validar entradas de ese evento."],
        canForce: false,
        canRetry: false,
      };
    default:
      return {
        tone: "bad",
        title: "Entrada no válida",
        tier,
        person,
        lines: [`Motivo: ${row.result}`],
        canForce: false,
        canRetry: false,
      };
  }
};

const ResultOverlay = ({
  outcome,
  selectedEvent,
  validating,
  forceOpen,
  forceReason,
  onForceReasonChange,
  onOpenForce,
  onCancelForce,
  onSubmitForce,
  onRetry,
  onDismiss,
}: {
  outcome: Outcome;
  selectedEvent: ScannerEvent | null;
  validating: boolean;
  forceOpen: boolean;
  forceReason: string;
  onForceReasonChange: (v: string) => void;
  onOpenForce: () => void;
  onCancelForce: () => void;
  onSubmitForce: (e: React.FormEvent) => void;
  onRetry: () => void;
  onDismiss: () => void;
}) => {
  const view = describeOutcome(outcome, selectedEvent);
  const ok = view.tone === "ok";
  const Icon = ok ? CheckCircle2 : view.tone === "offline" ? WifiOff : view.canForce ? AlertTriangle : XCircle;
  const background = ok ? "bg-emerald-600" : view.tone === "offline" ? "bg-amber-600" : "bg-red-700";
  const accentText = ok ? "text-emerald-700" : view.tone === "offline" ? "text-amber-700" : "text-red-700";

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="scan-result-title"
      aria-describedby="scan-result-desc"
      className={`fixed inset-0 z-[80] flex flex-col overflow-y-auto text-white ${background}`}
      style={{
        paddingTop: "max(1.5rem, env(safe-area-inset-top))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
      }}
      onClick={ok ? onDismiss : undefined}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <Icon className="h-24 w-24 shrink-0" strokeWidth={2.2} aria-hidden="true" />
        <h2 id="scan-result-title" className="text-4xl font-extrabold leading-tight tracking-tight">
          {view.title}
        </h2>
        {view.tier && (
          <div className="max-w-full truncate rounded-full bg-white/15 px-5 py-2 text-2xl font-bold">
            {view.tier}
          </div>
        )}
        {view.person && <div className="max-w-full truncate text-xl font-semibold">{view.person}</div>}
        <div id="scan-result-desc" className="space-y-1.5 text-base leading-snug text-white/90">
          {view.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-6 w-full max-w-md space-y-2 px-6">
        {ok ? (
          <Button
            type="button"
            onClick={(e) => {
              e.stopPropagation(); // el fondo verde también cierra: una sola vez
              onDismiss();
            }}
            className={`h-12 w-full bg-white text-base font-semibold hover:bg-white/90 ${accentText}`}
          >
            Siguiente
          </Button>
        ) : forceOpen ? (
          <form onSubmit={onSubmitForce} className="space-y-2 rounded-2xl bg-black/20 p-3 text-left">
            <label htmlFor="force-reason" className="block text-sm font-semibold">
              Motivo para dejar pasar
            </label>
            <Input
              id="force-reason"
              value={forceReason}
              onChange={(e) => onForceReasonChange(e.target.value)}
              placeholder="Ej.: se equivocó de entrada, autorizado por gerencia"
              maxLength={200}
              autoFocus
              className="h-12 bg-white text-base text-neutral-900 placeholder:text-neutral-500"
            />
            <p className="text-[12px] text-white/80">Queda registrado con tu usuario y la hora.</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onCancelForce}
                disabled={validating}
                className="h-12 flex-1 border-white/50 bg-transparent text-white hover:bg-white/10 hover:text-white"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={validating || forceReason.trim().length < 3}
                className={`h-12 flex-1 bg-white font-semibold hover:bg-white/90 ${accentText}`}
              >
                {validating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Dar entrada
              </Button>
            </div>
          </form>
        ) : (
          <>
            {view.canRetry && (
              <Button
                type="button"
                onClick={onRetry}
                disabled={validating}
                autoFocus
                className={`h-12 w-full bg-white text-base font-semibold hover:bg-white/90 ${accentText}`}
              >
                {validating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 h-4 w-4" />
                )}
                Reintentar
              </Button>
            )}
            {view.canForce && (
              <Button
                type="button"
                variant="outline"
                onClick={onOpenForce}
                disabled={validating}
                className="h-12 w-full border-white/60 bg-transparent text-base text-white hover:bg-white/10 hover:text-white"
              >
                Dar entrada igualmente
              </Button>
            )}
            <Button
              type="button"
              onClick={onDismiss}
              disabled={validating}
              autoFocus={!view.canRetry}
              className={
                view.canRetry
                  ? "h-12 w-full border border-white/60 bg-transparent text-base text-white hover:bg-white/10"
                  : `h-12 w-full bg-white text-base font-semibold hover:bg-white/90 ${accentText}`
              }
            >
              {view.canRetry ? "Cerrar" : "Escanear siguiente"}
            </Button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
};

// ----------------------------------------------------------------------------
// Visor
// ----------------------------------------------------------------------------

const CornerBrackets = ({ active }: { active: boolean }) => {
  const color = active ? "#FF7A4D" : "rgba(244,238,226,0.35)";
  const glow = active ? `0 0 18px ${color}aa` : "none";
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ width: "min(70%, 360px)", height: "min(70%, 360px)" }}
    >
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
