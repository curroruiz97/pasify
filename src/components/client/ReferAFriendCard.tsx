import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Check, Copy, Loader2, Share2, UserPlus, Users, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { qk } from "@/lib/cache/keys";
import { useCurrentUserId } from "@/lib/cache/session";
import { WEB_BASE } from "@/lib/redirect-url";

/**
 * ReferAFriendCard — invitar amigos (mig 0052).
 *
 *   - Llama RPC `get_or_create_my_referral_code()` al montar.
 *   - Permite copiar o compartir el código + canjear códigos ajenos via RPC
 *     `redeem_referral_code(_code)`. El canje deja el referido pendiente: los
 *     500 puntos para cada uno llegan con la primera compra de pago de la
 *     cuenta invitada (grant_referral_on_first_purchase, Ola 2).
 *   - Muestra contador de invitados ya canjeados (SELECT count
 *     referral_claims WHERE referrer_user_id = me).
 *
 * Sin equivalencia en euros ni "5 € para los dos" (D-5): los puntos aún no se
 * pueden canjear por nada.
 *
 * El enlace va SIEMPRE a la web pública (WEB_BASE): desde la app nativa
 * window.location.origin es `capacitor://localhost` y el enlace no servía
 * fuera. El alta lee `?ref=` y guarda el código.
 *
 * Gate: si el usuario no está logueado, no renderizamos nada — la card
 * vive dentro de ClientLoyalty que ya requiere auth.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

/** Puntos que da `redeem_referral_code` a cada uno (referral_claims.reward_points). */
const PUNTOS_POR_INVITACION = 500;

/** Enlace de invitación: alta en la web pública con el código. */
const referralLink = (code: string): string =>
  `${WEB_BASE}/#/register-client?ref=${encodeURIComponent(code)}`;

const esCancelacion = (err: unknown) =>
  err instanceof Error && /cancel|abort/i.test(`${err.name} ${err.message}`);

export const ReferAFriendCard = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const uid = useCurrentUserId();
  const [code, setCode] = useState<string | null>(null);
  const [loadingCode, setLoadingCode] = useState(true);
  const [invitedCount, setInvitedCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [redeemInput, setRedeemInput] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [alreadyRedeemed, setAlreadyRedeemed] = useState(false);

  const load = useCallback(async () => {
    if (!uid) return;
    setLoadingCode(true);
    try {
      const { data: codeData, error: codeErr } = await supabase.rpc(
        "get_or_create_my_referral_code"
      );
      if (codeErr) throw codeErr;
      if (typeof codeData === "string") setCode(codeData);

      // Count invitados (referrer = me)
      const { count } = await supabase
        .from("referral_claims")
        .select("id", { count: "exact", head: true })
        .eq("referrer_user_id", uid);
      setInvitedCount(count ?? 0);

      // Detectar si YO ya canjeé un código ajeno
      const { data: myClaim } = await supabase
        .from("referral_claims")
        .select("id")
        .eq("referee_user_id", uid)
        .maybeSingle();
      setAlreadyRedeemed(!!myClaim);
    } catch (err) {
      console.warn("[ReferAFriend] load failed", err);
    } finally {
      setLoadingCode(false);
    }
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: "No se pudo copiar", variant: "destructive" });
    }
  };

  // Hoja de compartir nativa (app), Web Share (web) o, si no hay, portapapeles.
  const share = async () => {
    if (!code) return;
    const text = `Únete a Pasify con mi código ${code}: con tu primera compra, los dos sumamos ${PUNTOS_POR_INVITACION} Pasify Points.`;
    const url = referralLink(code);
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({ title: "Pasify", text, url, dialogTitle: "Invitar a un amigo" });
        return;
      }
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: "Pasify", text, url });
        return;
      }
    } catch (err) {
      // Cerrar la hoja de compartir no es un error.
      if (esCancelacion(err)) return;
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast({ title: "Invitación copiada", description: "Pégala y compártela donde quieras." });
    } catch {
      toast({ title: "Copia este enlace", description: url });
    }
  };

  const redeem = async () => {
    const clean = redeemInput.trim().toUpperCase();
    if (clean.length !== 8) {
      toast({ title: "Código de 8 caracteres", variant: "destructive" });
      return;
    }
    setRedeeming(true);
    try {
      const { error } = await supabase.rpc("redeem_referral_code", { _code: clean });
      if (error) throw error;
      toast({
        title: "Código canjeado",
        description: `Con tu primera compra, los dos sumaréis ${PUNTOS_POR_INVITACION} Pasify Points.`,
      });
      setRedeemInput("");
      // El saldo de Puntos tiene que moverse ya, no al próximo refresco.
      if (uid) void queryClient.invalidateQueries({ queryKey: qk.me.loyalty(uid) });
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Código no válido";
      toast({ title: "No se pudo canjear", description: msg, variant: "destructive" });
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <section
      className="relative overflow-hidden rounded-2xl border p-5 md:p-6"
      style={{
        background: "linear-gradient(135deg, rgba(232,84,42,0.12) 0%, rgba(184,56,26,0.04) 100%)",
        borderColor: "rgba(232,84,42,0.4)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-60 w-60 rounded-full"
        style={{ background: "rgba(232,84,42,0.2)", filter: "blur(70px)" }}
      />

      <div className="relative">
        <div className="flex items-start gap-3">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -6px rgba(232,84,42,0.6)",
            }}
          >
            <UserPlus className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              <Zap className="h-3 w-3" />
              Invita a tus amigos
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              Trae a un amigo a Pasify
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Comparte tu código. Cuando tu amigo lo canjee y haga su primera compra, los dos sumáis{" "}
              {PUNTOS_POR_INVITACION} Pasify Points.
            </p>
          </div>
        </div>

        {/* Tu código */}
        <div className="mt-5 rounded-xl border border-border bg-background/40 p-4">
          <div
            className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <Users className="h-3 w-3" />
            Tu código · {invitedCount} {invitedCount === 1 ? "amigo invitado" : "amigos invitados"}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div
              className="flex-1 text-3xl font-bold tracking-[0.18em] text-foreground"
              style={mono}
            >
              {loadingCode ? (
                <span className="text-base text-muted-foreground">
                  <Loader2 className="inline h-4 w-4 animate-spin" /> generando…
                </span>
              ) : (
                code ?? "—"
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={copyCode}
                disabled={!code || copied}
              >
                {copied ? <Check className="mr-2 h-3.5 w-3.5 text-green-500" /> : <Copy className="mr-2 h-3.5 w-3.5" />}
                {copied ? "Copiado" : "Copiar"}
              </Button>
              <Button
                size="sm"
                onClick={() => void share()}
                disabled={!code}
                className="text-white"
                style={{
                  background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
                }}
              >
                <Share2 className="mr-2 h-3.5 w-3.5" />
                Compartir
              </Button>
            </div>
          </div>
        </div>

        {/* Canjear código ajeno */}
        {!alreadyRedeemed && (
          <div className="mt-3 rounded-xl border border-dashed border-border bg-background/30 p-4">
            <div
              className="mb-2 text-[10px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              ¿Te invitó un amigo? Canjea su código
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={redeemInput}
                onChange={(e) => setRedeemInput(e.target.value.toUpperCase())}
                placeholder="ABCD1234"
                maxLength={8}
                className="flex-1 font-mono uppercase tracking-[0.2em]"
                disabled={redeeming}
              />
              <Button
                onClick={() => void redeem()}
                disabled={redeeming || redeemInput.trim().length !== 8}
              >
                {redeeming ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                Canjear
              </Button>
            </div>
          </div>
        )}
        {alreadyRedeemed && (
          <div
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px]"
            style={{
              background: "rgba(77,184,122,0.10)",
              borderColor: "rgba(77,184,122,0.32)",
              color: "#4DB87A",
              ...mono,
            }}
          >
            <Check className="h-3 w-3" />
            Ya canjeaste un código · cada cuenta puede usar uno
          </div>
        )}
      </div>
    </section>
  );
};

export default ReferAFriendCard;
