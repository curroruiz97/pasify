import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Loader2, Lock, LogOut, ScanLine } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Wordmark } from "@/components/Wordmark";
import QRScanner from "@/components/partner/QRScanner";
import { supabase } from "@/integrations/supabase/client";
import { usePartnerEvents, type PartnerEventRow } from "@/hooks/queries/partnerData";
import { useAuth, signOutLocal } from "@/hooks/useAuth";
import { clearDoorLock, isDoorLocked, isValidDoorPin, lockDoor, unlockDoor } from "@/lib/doorLock";

/**
 * Modo puerta (/door): pantalla completa con solo el escáner.
 *
 * El dueño activa el modo con un PIN y deja el móvil en la puerta. Mientras
 * está activo, el panel redirige aquí (isDoorLocked) y salir pide el PIN. El
 * escáner va en doorMode: sin email del comprador ni "dar entrada
 * igualmente". Funciona aunque el plan del local haya caducado (la ruta no
 * pasa por PartnerGate): la puerta nunca se cierra por facturación.
 */

interface DoorEvent {
  id: string;
  title: string;
  date_start: string;
  date_end: string | null;
  status: string;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

/**
 * La puerta solo necesita lo de estos días (de hace 3 días a dentro de 7) y
 * lo que se vende o se ha vendido. Sale de la lista de eventos del panel, que
 * está en la caché y guardada en el dispositivo: el dueño activa el modo
 * desde el panel, así que la puerta abre al instante aunque no haya
 * cobertura.
 */
function eventosDePuerta(eventos: PartnerEventRow[], ahora = Date.now()): DoorEvent[] {
  const desde = ahora - 3 * 24 * 3600_000;
  const hasta = ahora + 7 * 24 * 3600_000;
  return eventos
    .filter((e) => {
      const t = new Date(e.date_start).getTime();
      return (e.status === "published" || e.status === "past") && t >= desde && t <= hasta;
    })
    .map((e) => ({ id: e.id, title: e.title, date_start: e.date_start, date_end: e.date_end, status: e.status }))
    .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());
}

const DoorMode = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const uid = user?.id ?? null;

  // Desde el primer render: antes arrancaba en false y se veía un instante la
  // pantalla de configurar el PIN antes del escáner.
  const [locked, setLocked] = useState(() => isDoorLocked(uid));

  useEffect(() => {
    setLocked(isDoorLocked(uid));
  }, [uid]);

  const eventsQuery = usePartnerEvents(uid);
  const events = useMemo(() => eventosDePuerta(eventsQuery.data ?? []), [eventsQuery.data]);
  const eventsState: "loading" | "error" | "ready" = eventsQuery.data
    ? "ready"
    : eventsQuery.isError
      ? "error"
      : "loading";

  // Android: el botón atrás no saca del modo puerta.
  useEffect(() => {
    if (!locked || !Capacitor.isNativePlatform()) return;
    const handle = CapacitorApp.addListener("backButton", () => {
      /* bloqueado: nada */
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [locked]);

  useEffect(() => {
    document.title = "Modo puerta · Pasify";
  }, []);

  if (authLoading || !uid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!locked) {
    return (
      <DoorSetup
        uid={uid}
        onLocked={() => setLocked(true)}
        onCancel={() => navigate("/partner-dashboard")}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header
        className="flex items-center justify-between gap-3 border-b border-border px-4 py-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <div className="flex items-center gap-3">
          <Wordmark height={24} />
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-orange-500">
            <Lock className="h-3.5 w-3.5" />
            Modo puerta
          </span>
        </div>
        <ExitButton uid={uid} onExit={() => navigate("/partner-dashboard", { replace: true })} />
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-10 pt-4">
        <QRScanner events={events} eventsState={eventsState} doorMode />
      </main>
    </div>
  );
};

const DoorSetup = ({ uid, onLocked, onCancel }: { uid: string; onLocked: () => void; onCancel: () => void }) => {
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidDoorPin(pin)) return setError("El PIN tiene que tener de 4 a 6 cifras.");
    if (pin !== pin2) return setError("Los dos PIN no coinciden.");
    setSaving(true);
    try {
      await lockDoor(uid, pin);
      onLocked();
    } catch {
      setError("No se ha podido activar el modo puerta en este dispositivo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-orange-500/15 text-orange-500">
            <ScanLine className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Modo puerta</h1>
            <p className="text-xs text-muted-foreground">Solo el escáner, a pantalla completa.</p>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Deja este móvil a tu portero: no podrá entrar en el panel, ver emails de los compradores
          ni forzar entradas. Para salir hará falta este PIN.
        </p>
        <div className="space-y-3">
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="PIN (4 a 6 cifras)"
            value={pin}
            maxLength={6}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ""));
              setError(null);
            }}
          />
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Repite el PIN"
            value={pin2}
            maxLength={6}
            onChange={(e) => {
              setPin2(e.target.value.replace(/\D/g, ""));
              setError(null);
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
            Volver al panel
          </Button>
          <Button type="submit" className="flex-1" disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
            Activar
          </Button>
        </div>
      </form>
    </div>
  );
};

const ExitButton = ({ uid, onExit }: { uid: string; onExit: () => void }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const attempts = useRef(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);
  const waitSeconds = Math.max(0, Math.ceil((lockedUntil - now) / 1000));

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (waitSeconds > 0) return;
      setChecking(true);
      const ok = await unlockDoor(uid, pin).catch(() => false);
      setChecking(false);
      if (ok) {
        setOpen(false);
        onExit();
        return;
      }
      attempts.current += 1;
      setPin("");
      if (attempts.current >= MAX_ATTEMPTS) {
        attempts.current = 0;
        setLockedUntil(Date.now() + LOCKOUT_MS);
        setNow(Date.now());
        setError("Demasiados intentos. Espera 30 segundos.");
      } else {
        setError("PIN incorrecto.");
      }
    },
    [onExit, pin, uid, waitSeconds],
  );

  const forgot = async () => {
    // Cerrar sesión borra el bloqueo; para volver hace falta la contraseña del dueño.
    clearDoorLock();
    await signOutLocal();
    navigate("/login", { replace: true });
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <KeyRound className="mr-1.5 h-4 w-4" />
        Salir
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setPin("");
            setError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Salir del modo puerta</DialogTitle>
            <DialogDescription>Introduce el PIN con el que se activó en este móvil.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              placeholder="PIN"
              value={pin}
              maxLength={6}
              disabled={waitSeconds > 0}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ""));
                setError(null);
              }}
            />
            {error && (
              <p className="text-sm text-destructive">
                {waitSeconds > 0 ? `Demasiados intentos. Espera ${waitSeconds} s.` : error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={checking || pin.length < 4 || waitSeconds > 0}>
              {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salir
            </Button>
            <button
              type="button"
              onClick={() => void forgot()}
              className="flex w-full items-center justify-center gap-1.5 text-xs text-muted-foreground underline underline-offset-4"
            >
              <LogOut className="h-3.5 w-3.5" />
              ¿Has olvidado el PIN? Cerrar sesión
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default DoorMode;
