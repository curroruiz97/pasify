import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { parseEdgeError } from "@/components/tickets/ticketUtils";
import { TimeoutError, withTimeout } from "@/lib/withTimeout";
import { rpcAdmin } from "./adminQueries";

/* ============================================================================
   Acciones del panel de admin que mueven dinero o avisan a alguien: RPC y
   edge functions, con sus errores traducidos a algo que se entienda.

   Tres piezas llegan en la Ola 2 desde otras ramas: admin_set_org_suspension
   (checkout), decide-refund (reembolsos) y resend-tickets-email (checkout).
   Mientras no estén desplegadas, la acción lo dice claro; en decide-refund,
   además, se sigue por el camino anterior (RPC decide_refund +
   process-refund) para que la cola no se quede parada.
   ============================================================================ */

type RpcError = { message: string; code?: string; details?: string | null; hint?: string | null };

/** La RPC no existe en el servidor: su migración aún no está desplegada. */
export const rpcAusente = (e: RpcError | null | undefined): boolean =>
  !!e && (e.code === "PGRST202" || e.code === "42883");

const TIMEOUT_RPC_MS = 20_000;

/** Una RPC con tiempo máximo: nunca deja un botón girando para siempre. */
async function llamarRpc<T>(nombre: string, args: Record<string, unknown>): Promise<{ data: T | null; error: RpcError | null }> {
  try {
    return await withTimeout(rpcAdmin<T>(nombre, args), TIMEOUT_RPC_MS, nombre);
  } catch (e) {
    return {
      data: null,
      error: {
        message: e instanceof TimeoutError ? "El servidor no ha contestado a tiempo." : String(e),
        code: e instanceof TimeoutError ? "timeout" : undefined,
      },
    };
  }
}

// ============================================================================
// Edge functions
// ============================================================================

export type EdgeFallo = {
  ok: false;
  /** Status HTTP; null si no hubo respuesta (red caída, tiempo agotado). */
  status: number | null;
  code: string | null;
  /** Texto para el usuario que devuelve la función (contrato nuevo), si lo hay. */
  message: string | null;
  /** La función no está desplegada: 404 del gateway, sin código propio. */
  ausente: boolean;
};

export type EdgeResultado<T> = { ok: true; data: T } | EdgeFallo;

export async function invocarEdge<T>(
  nombre: string,
  body: Record<string, unknown>,
  timeoutMs = 45_000,
): Promise<EdgeResultado<T>> {
  try {
    const { data, error } = await withTimeout(supabase.functions.invoke(nombre, { body }), timeoutMs, nombre);
    if (!error) return { ok: true, data: (data ?? null) as T };
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      const cuerpo: unknown = await res
        .clone()
        .json()
        .catch(() => null);
      const p = parseEdgeError(cuerpo);
      return { ok: false, status: res.status, code: p.code, message: p.message, ausente: res.status === 404 && !p.code };
    }
    return { ok: false, status: null, code: null, message: null, ausente: false };
  } catch (e) {
    return { ok: false, status: null, code: e instanceof TimeoutError ? "timeout" : null, message: null, ausente: false };
  }
}

const SIN_RESPUESTA = "No hemos podido hablar con el servidor. Revisa la conexión y vuelve a intentarlo.";
const TIEMPO_AGOTADO = "El servidor está tardando demasiado. Espera un poco y comprueba el resultado antes de repetir.";

/** Mensaje para un fallo de edge function con su tabla de códigos. */
function mensajeEdge(f: EdgeFallo, tabla: Record<string, string>, porDefecto: string): string {
  if (f.code && tabla[f.code]) return tabla[f.code];
  if (f.code === "timeout") return TIEMPO_AGOTADO;
  if (f.message) return f.message;
  if (f.status === null) return SIN_RESPUESTA;
  if (f.code === "rate_limit_exceeded") return "Demasiados intentos seguidos. Espera unos minutos.";
  return porDefecto;
}

/** Aviso (toast) que devuelve cada acción. */
export interface Aviso {
  ok: boolean;
  titulo: string;
  descripcion?: string;
}

// ============================================================================
// Reembolsos: process-refund y decide-refund
// ============================================================================

/** Códigos de error de process-refund (y de la ejecución dentro de decide-refund). */
export const ERRORES_PROCESS_REFUND: Record<string, string> = {
  ticket_not_refundable: "La entrada ya no se puede devolver: está usada, transferida o sin pagar.",
  order_not_refundable: "El pedido ya no admite reembolsos.",
  nothing_to_refund: "No hay importe que devolver.",
  no_payment_intent: "El pedido no tiene un pago de Stripe asociado.",
  already_processing: "Ya se está tramitando: espera a que Stripe conteste.",
  already_refunded: "La solicitud ya tiene un reembolso en Stripe.",
  invalid_status: "La solicitud ya no está aprobada.",
  stripe_refund_failed: "Stripe ha rechazado el reembolso: lo tienes en Reembolsos › «Con incidencia» con el motivo.",
  stripe_unavailable: "Stripe no ha contestado: podrás retomarlo en unos minutos desde Reembolsos.",
  forbidden: "No tienes permiso para lanzar este reembolso.",
  request_not_found: "La solicitud ya no existe.",
};

/** Lanza en Stripe una solicitud aprobada. null si ha ido bien; si no, el motivo. */
export async function lanzarProcessRefund(requestId: string): Promise<string | null> {
  const r = await invocarEdge<{ stripe_refund_id?: string; status?: string }>("process-refund", { request_id: requestId });
  if (r.ok === true) return null;
  return mensajeEdge(r, ERRORES_PROCESS_REFUND, "Stripe no ha podido tramitarlo ahora. Vuelve a intentarlo en unos minutos.");
}

const DECISION_YA_TOMADA = "Otra persona ya la ha decidido. La lista se ha actualizado.";
const NOTA_OBLIGATORIA = "Escribe el motivo de la denegación (5 caracteres o más).";

const ERRORES_DECIDE_REFUND: Record<string, string> = {
  forbidden: "No tienes permiso para decidir esta solicitud.",
  request_not_found: "La solicitud ya no existe.",
  already_decided: DECISION_YA_TOMADA,
  request_already_decided: DECISION_YA_TOMADA,
  not_pending: DECISION_YA_TOMADA,
  invalid_status: DECISION_YA_TOMADA,
  note_required: NOTA_OBLIGATORIA,
  decision_note_required: NOTA_OBLIGATORIA,
  rejection_note_required: NOTA_OBLIGATORIA,
  note_too_short: NOTA_OBLIGATORIA,
  invalid_note: NOTA_OBLIGATORIA,
  invalid_decision: "Decisión no válida.",
  invalid_payload: "La petición no es válida.",
};

/** Códigos de la ejecución en Stripe: la decisión ya se ha guardado. */
const EJECUCION_STRIPE = new Set(["stripe_refund_failed", "stripe_unavailable", "already_processing"]);

/** decide_refund (RPC) lanza mensajes técnicos: los habituales, en claro. */
const mensajeDecisionRpc = (m: string) => {
  if (/ya decidida/i.test(m)) return DECISION_YA_TOMADA;
  if (/motivo/i.test(m)) return NOTA_OBLIGATORIA;
  if (/sin permisos/i.test(m)) return "No tienes permiso para decidir esta solicitud.";
  return m;
};

/** Aviso tras aprobar, según el estado en el que queda la solicitud. */
function avisoAprobado(status: string | null | undefined): Aviso {
  switch (status) {
    case "refunded":
      return { ok: true, titulo: "Reembolso hecho", descripcion: "El comprador recibirá el dinero y un aviso." };
    case "failed":
      return {
        ok: false,
        titulo: "Aprobado, pero Stripe lo ha rechazado",
        descripcion: "Lo tienes en «Con incidencia» con el motivo; desde ahí se puede reintentar.",
      };
    case "approved":
      return {
        ok: false,
        titulo: "Aprobado, pero sin reembolsar todavía",
        descripcion: "Stripe no lo ha recibido: en unos minutos podrás retomarlo desde «Con incidencia».",
      };
    default:
      return { ok: true, titulo: "Reembolso aprobado", descripcion: "Stripe lo está tramitando." };
  }
}

/** Camino anterior (sin decide-refund desplegada): RPC y, al aprobar, process-refund. */
async function decidirPorRpc(requestId: string, decision: "approve" | "reject", nota: string | null): Promise<Aviso> {
  const { error } = await withTimeout(
    supabase.rpc("decide_refund", {
      _request_id: requestId,
      _decision: decision,
      ...(nota ? { _note: nota } : {}),
    }),
    TIMEOUT_RPC_MS,
    "decide_refund",
  ).catch((e: unknown) => ({ error: { message: e instanceof TimeoutError ? TIEMPO_AGOTADO : String(e) } }));
  if (error) {
    return {
      ok: false,
      titulo: decision === "approve" ? "No se ha podido aprobar" : "No se ha podido denegar",
      descripcion: mensajeDecisionRpc(error.message),
    };
  }
  if (decision === "reject") {
    return {
      ok: true,
      titulo: "Reembolso denegado",
      descripcion: "El motivo queda guardado, pero el email al comprador no ha salido: decide-refund aún no está desplegada.",
    };
  }
  const fallo = await lanzarProcessRefund(requestId);
  return fallo ? { ok: false, titulo: "Aprobado, pero sin reembolsar todavía", descripcion: fallo } : avisoAprobado(null);
}

/**
 * Decide una solicitud pendiente con la edge function decide-refund: aprobar
 * ejecuta el reembolso; denegar envía al comprador el email con el motivo.
 */
export async function decidirReembolso(
  requestId: string,
  decision: "approve" | "reject",
  nota: string | null,
): Promise<Aviso> {
  const r = await invocarEdge<{ status?: string }>(
    "decide-refund",
    { request_id: requestId, decision, ...(nota ? { note: nota } : {}) },
    60_000,
  );
  if (r.ok === true) {
    if (decision === "reject") {
      return { ok: true, titulo: "Reembolso denegado", descripcion: "Le hemos enviado al comprador un email con el motivo." };
    }
    return avisoAprobado(r.data?.status ?? null);
  }
  if (r.ausente) return decidirPorRpc(requestId, decision, nota);
  // Stripe falló al ejecutar: la aprobación ya está hecha y la solicitud
  // sigue en la cola (Con incidencia o En curso).
  if (decision === "approve" && r.code && EJECUCION_STRIPE.has(r.code)) {
    return { ok: false, titulo: "Aprobado, pero sin reembolsar todavía", descripcion: ERRORES_PROCESS_REFUND[r.code] };
  }
  return {
    ok: false,
    titulo: decision === "approve" ? "No se ha podido aprobar" : "No se ha podido denegar",
    descripcion: mensajeEdge(
      r,
      { ...ERRORES_PROCESS_REFUND, ...ERRORES_DECIDE_REFUND },
      "No se ha podido completar. Vuelve a intentarlo.",
    ),
  };
}

// ============================================================================
// Pedidos: reembolsar una entrada, reenviar el email
// ============================================================================

const ERRORES_REEMBOLSO_ADMIN: Record<string, string> = {
  note_required: "Explica el motivo al comprador (5 caracteres o más): lo leerá en el email.",
  note_too_long: "El motivo es demasiado largo (1.000 caracteres como mucho).",
  ticket_not_found: "La entrada ya no existe.",
  ticket_used: "La entrada ya se ha usado en la puerta: no se reembolsa.",
  already_refunded: "Esta entrada ya está reembolsada.",
  ticket_not_paid: "La entrada no está pagada (pendiente, cancelada o anulada).",
  nothing_to_refund: "La entrada no costó nada: no hay importe que devolver.",
  order_not_refundable: "El pedido ya no admite reembolsos.",
  no_payment_intent: "El pedido no tiene un pago de Stripe asociado.",
  test_payment: "Es un pago de prueba de Stripe: no se reembolsa con la cuenta real.",
  refund_in_progress: "Ya hay un reembolso en curso para esta entrada: síguelo en Reembolsos.",
};

/**
 * Reembolsa una entrada: la solicitud la crea el sistema ya aprobada
 * (admin_create_refund_request) y process-refund la ejecuta en Stripe y avisa
 * al comprador con la nota como motivo.
 */
export async function reembolsarEntrada(ticketId: string, nota: string): Promise<Aviso> {
  const { data, error } = await llamarRpc<string>("admin_create_refund_request", { _ticket_id: ticketId, _note: nota });
  if (error || !data) {
    const descripcion = rpcAusente(error)
      ? "Esta función aún no está en el servidor: falta desplegar la migración del panel de admin (Ola 2)."
      : (error && ERRORES_REEMBOLSO_ADMIN[error.message]) ?? error?.message ?? "El servidor no ha devuelto la solicitud.";
    return { ok: false, titulo: "No se ha podido reembolsar", descripcion };
  }
  const fallo = await lanzarProcessRefund(data);
  return fallo
    ? { ok: false, titulo: "Solicitud aprobada, pero sin reembolsar todavía", descripcion: fallo }
    : { ok: true, titulo: "Reembolso en marcha", descripcion: "Stripe lo está tramitando; el comprador recibirá un aviso." };
}

const ERRORES_REENVIO: Record<string, string> = {
  forbidden: "No tienes permiso para reenviar las entradas de este pedido.",
  order_not_found: "El pedido ya no existe.",
  order_not_paid: "El pedido no está pagado: no hay entradas que reenviar.",
  not_paid: "El pedido no está pagado: no hay entradas que reenviar.",
  no_tickets: "El pedido no tiene entradas válidas que reenviar.",
  no_email: "El pedido no tiene un email al que enviarlas.",
  email_not_configured: "El envío de emails no está configurado en el servidor.",
  email_provider_not_configured: "El envío de emails no está configurado en el servidor.",
  rate_limit_exceeded: "Demasiados reenvíos seguidos. Espera unos minutos.",
  invalid_payload: "La petición no es válida.",
};

/** Reenvía al comprador el email con sus entradas (resend-tickets-email). */
export async function reenviarEntradas(orderId: string, email: string | null): Promise<Aviso> {
  const r = await invocarEdge<{ sent?: boolean }>("resend-tickets-email", { order_id: orderId });
  if (r.ok === true) {
    return r.data?.sent === false
      ? { ok: false, titulo: "El email no ha salido", descripcion: "El servidor no ha podido enviarlo. Vuelve a intentarlo en unos minutos." }
      : { ok: true, titulo: "Email reenviado", descripcion: email ? `Con las entradas, a ${email}.` : undefined };
  }
  if (r.ausente) {
    return {
      ok: false,
      titulo: "El reenvío aún no está disponible",
      descripcion: "Falta desplegar la función resend-tickets-email en el servidor.",
    };
  }
  return { ok: false, titulo: "No se ha podido reenviar", descripcion: mensajeEdge(r, ERRORES_REENVIO, "Vuelve a intentarlo en unos minutos.") };
}

// ============================================================================
// Eventos: cancelar y reembolsar (partner-cancel-event, que acepta al admin)
// ============================================================================

interface CancelacionRonda {
  already_cancelled: boolean;
  refunded: number;
  failed: number;
  remaining: number;
  refunds_pending: boolean;
  tickets_without_account: number;
}

const ERRORES_CANCELAR: Record<string, string> = {
  forbidden: "Tu cuenta no puede cancelar este evento.",
  event_not_cancellable: "Este evento ya terminó y no se puede cancelar.",
  cancel_reason_required: "Escribe el motivo de la cancelación (3 caracteres o más).",
  event_not_found: "El evento ya no existe.",
  invalid_payload: "La petición no es válida.",
  rate_limit_exceeded: "Demasiados intentos seguidos. Espera unos minutos.",
};

/** Tandas como mucho por llamada del panel: la edge function reembolsa unos 60 s por tanda. */
const MAX_RONDAS = 10;

/**
 * Cancela un evento (estado final) y reembolsa a todos los que pagaron, por
 * tandas. Con el evento ya cancelado, reintenta los reembolsos que falten.
 */
export async function cancelarYReembolsar(eventId: string, motivo: string, reintento: boolean): Promise<Aviso> {
  let reembolsados = 0;
  let ultima: CancelacionRonda | null = null;
  for (let ronda = 0; ronda < MAX_RONDAS; ronda++) {
    const r = await invocarEdge<CancelacionRonda>("partner-cancel-event", { event_id: eventId, reason: motivo }, 150_000);
    if (r.ok === false) {
      const descripcion = mensajeEdge(r, ERRORES_CANCELAR, "Vuelve a intentarlo en unos minutos.");
      if (!ultima) {
        return { ok: false, titulo: reintento ? "No se han podido reintentar los reembolsos" : "No se ha podido cancelar el evento", descripcion };
      }
      return {
        ok: false,
        titulo: reintento ? "Reembolsos a medias" : "Evento cancelado, reembolsos a medias",
        descripcion: `${reembolsados} reembolso(s) hechos. ${descripcion} Vuelve a lanzarlo con «Reintentar reembolsos».`,
      };
    }
    ultima = r.data;
    reembolsados += r.data?.refunded ?? 0;
    if (!r.data || r.data.remaining === 0) break;
  }

  const pendientes = ultima?.refunds_pending
    ? " Algunos reembolsos no se han podido hacer ahora: están en Reembolsos y aquí puedes «Reintentar reembolsos»."
    : "";
  const sinCuenta =
    ultima && ultima.tickets_without_account > 0
      ? ` ${ultima.tickets_without_account} entrada(s) pagadas sin cuenta ni email: hay que devolverlas a mano.`
      : "";
  if (reintento || ultima?.already_cancelled) {
    return {
      ok: !ultima?.refunds_pending,
      titulo: reembolsados > 0 ? `${reembolsados} reembolso(s) hechos` : "No quedaban reembolsos pendientes",
      descripcion: (pendientes + sinCuenta).trim() || undefined,
    };
  }
  return {
    ok: !ultima?.refunds_pending,
    titulo: "Evento cancelado",
    descripcion:
      (reembolsados > 0
        ? `${reembolsados} comprador(es) recibirán su dinero y un aviso.`
        : "Hemos avisado a quien tenía entradas.") +
      pendientes +
      sinCuenta,
  };
}

// ============================================================================
// Locales: suspender y reactivar (admin_set_org_suspension, del checkout)
// ============================================================================

export async function cambiarSuspension(orgId: string, suspender: boolean, motivo: string | null): Promise<Aviso> {
  const { error } = await llamarRpc<null>("admin_set_org_suspension", {
    _org_id: orgId,
    _suspended: suspender,
    _reason: motivo,
  });
  if (!error) {
    return suspender
      ? { ok: true, titulo: "Local suspendido", descripcion: "Ya no vende ni publica y sus eventos no se ven. Le hemos avisado." }
      : { ok: true, titulo: "Local reactivado", descripcion: "Vuelve a poder vender y publicar." };
  }
  const titulo = suspender ? "No se ha podido suspender" : "No se ha podido reactivar";
  if (rpcAusente(error)) {
    return {
      ok: false,
      titulo,
      descripcion: "La suspensión aún no está en el servidor: falta desplegar la migración del checkout (admin_set_org_suspension).",
    };
  }
  if (error.code === "42501") return { ok: false, titulo, descripcion: "Solo un admin puede suspender o reactivar un local." };
  return { ok: false, titulo, descripcion: error.message };
}

// ============================================================================
// Liquidaciones (admin_record_settlement)
// ============================================================================

export interface NuevaLiquidacion {
  orgId: string;
  amountCents: number;
  /** ISO de la fecha de la transferencia. */
  paidAt: string;
  reference: string;
  note: string | null;
  /** Confirmado: se transfirió más de lo pendiente. */
  allowExcess: boolean;
}

const ERRORES_LIQUIDACION: Record<string, string> = {
  org_not_found: "La organización ya no existe.",
  org_suspended: "El local está suspendido: no se le liquida hasta que se reactive.",
  amount_invalid: "El importe tiene que ser mayor que 0.",
  currency_invalid: "Moneda no válida.",
  bank_reference_required: "Escribe la referencia de la transferencia (3 caracteres o más).",
  bank_reference_too_long: "La referencia es demasiado larga (140 caracteres como mucho).",
  note_too_long: "La nota es demasiado larga (1.000 caracteres como mucho).",
  paid_at_in_future: "La fecha de la transferencia no puede ser futura.",
  paid_at_before_org: "La fecha es anterior al alta del local.",
  amount_exceeds_pending: "El importe supera lo pendiente. Si de verdad se transfirió más, márcalo en la casilla.",
  duplicate_settlement: "Esa transferencia ya está apuntada (mismo importe, referencia y día).",
};

export type ResultadoLiquidacion = { ok: true; id: string } | { ok: false; code: string | null; mensaje: string };

export async function registrarLiquidacion(l: NuevaLiquidacion): Promise<ResultadoLiquidacion> {
  const { data, error } = await llamarRpc<string>("admin_record_settlement", {
    _org_id: l.orgId,
    _amount_cents: l.amountCents,
    _paid_at: l.paidAt,
    _bank_reference: l.reference,
    _note: l.note,
    _currency: "EUR",
    _allow_excess: l.allowExcess,
  });
  if (!error && data) return { ok: true, id: data };
  if (rpcAusente(error)) {
    return {
      ok: false,
      code: "missing",
      mensaje: "Las liquidaciones aún no están en el servidor: falta desplegar la migración del panel de admin (Ola 2).",
    };
  }
  if (error?.code === "42501") return { ok: false, code: "forbidden", mensaje: "Solo un admin puede registrar liquidaciones." };
  const code = error?.message ?? null;
  return {
    ok: false,
    code,
    mensaje: (code && ERRORES_LIQUIDACION[code]) || error?.message || "El servidor no ha devuelto la liquidación.",
  };
}
