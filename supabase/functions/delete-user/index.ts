// Pasify · delete-user
// Borra la cuenta de OTRO usuario. Solo admins de plataforma (has_role admin).
// Ninguna pantalla la llama hoy (el antiguo components/admin/UsersManagement.tsx
// ya no existe). Responde { error: "<código>", message: "<texto>" } en los
// fallos, como delete-own-account.
//
// B3-13: antes se borraba el usuario sin más y, si era un local, sus eventos
// seguían publicados y vendiendo, sin dueño. Ahora, si es local (rol partner
// o dueño de alguna organización), antes de borrar nada cierra su actividad
// con la RPC admin_close_partner_account, llamada con el JWT del admin
// (comprueba has_role admin en la base de datos): cancela sus eventos futuros
// sin ventas, cierra sus organizaciones, da de baja a su equipo y cancela sus
// suscripciones. Si tiene eventos futuros con entradas vendidas se niega y
// respondemos 409 sin tocar la cuenta, como la baja propia: primero hay que
// cancelarlos y reembolsar (Eventos › Cancelar y reembolsar).
// Una cuenta de administrador no se borra desde aquí (409), ni la propia.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin, requireUser, isPlatformAdmin, userClientFrom } from "../_shared/supabase.ts";
import { HttpError } from "../_shared/internal-auth.ts";
import { logger } from "../_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const ADMIN_ACCOUNT = {
  error: 'admin_account',
  message: 'Una cuenta de administrador no se puede borrar desde aquí.',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed', message: 'Usa POST.' }, 405)
  }

  try {
    // OJO: antes se volcaban aquí todas las cabeceras al log, token incluido.
    const user = await requireUser(req)
    if (!(await isPlatformAdmin(user.id))) {
      return json({ error: 'forbidden', message: 'Solo un administrador puede eliminar usuarios.' }, 403)
    }

    const { userId } = await req.json().catch(() => ({}))
    // UUID estricto: el id también acaba dentro de un filtro .or() de PostgREST.
    if (!userId || typeof userId !== 'string' || !UUID_RE.test(userId)) {
      return json({ error: 'invalid_user_id', message: 'userId no válido.' }, 400)
    }
    if (userId === user.id) {
      return json({ error: 'self_delete', message: 'No puedes eliminar tu propia cuenta desde aquí.' }, 400)
    }

    const log = logger.child({ function: 'delete-user', admin_id: user.id, target_id: userId })

    // Roles y organizaciones propias con el cliente admin (un usuario puede
    // tener varias filas de rol). Si la consulta falla no se borra nada: el
    // control no puede fallar abierto.
    const [rolesRes, orgsRes] = await Promise.all([
      supabaseAdmin.from('user_roles').select('role').eq('user_id', userId),
      supabaseAdmin.from('organizations').select('id').eq('owner_id', userId).limit(1),
    ])
    if (rolesRes.error || orgsRes.error) {
      log.error('target_lookup_failed', { error: rolesRes.error?.message ?? orgsRes.error?.message })
      return json({ error: 'internal_error', message: 'No se ha podido comprobar la cuenta; no se ha borrado nada.' }, 500)
    }
    const roles = ((rolesRes.data ?? []) as Array<{ role: string }>).map((r) => r.role)

    if (roles.includes('admin')) {
      log.warn('delete_blocked_admin_account')
      return json(ADMIN_ACCOUNT, 409)
    }

    const isPartner = roles.includes('partner') || (orgsRes.data ?? []).length > 0
    if (isPartner) {
      const { data: closed, error: closeError } = await userClientFrom(req).rpc('admin_close_partner_account', {
        _user_id: userId,
      })
      if (closeError) {
        const detail = `${closeError.message ?? ''} ${closeError.details ?? ''} ${closeError.hint ?? ''}`
        if (detail.includes('partner_has_upcoming_sales')) {
          log.info('delete_blocked_upcoming_sales')
          return json({
            error: 'partner_has_upcoming_sales',
            message:
              'El local tiene eventos futuros con entradas vendidas. Cancélalos y reembolsa (Eventos › Cancelar y reembolsar) antes de borrar la cuenta.',
          }, 409)
        }
        if (detail.includes('target_is_admin')) {
          log.warn('delete_blocked_admin_account')
          return json(ADMIN_ACCOUNT, 409)
        }
        log.error('admin_close_partner_account_failed', { error: closeError.message, code: closeError.code })
        return json({
          error: 'partner_close_failed',
          message: 'No se ha podido cerrar la actividad del local; no se ha borrado nada.',
        }, 500)
      }
      log.info('partner_account_closed', { result: closed })
    }

    // Datos de tablas heredadas (si no existen, PostgREST devuelve error y seguimos).
    await supabaseAdmin.from('typing_indicators').delete().eq('user_id', userId)
    await supabaseAdmin.from('favorites').delete().or(`user_id.eq.${userId},favorite_user_id.eq.${userId}`)

    // Sus eventos y organizaciones sobreviven sin dueño (ON DELETE SET NULL):
    // las entradas y los pedidos son de los compradores.
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (deleteError) {
      const status = (deleteError as { status?: number }).status
      if (status === 404) {
        return json({ error: 'user_not_found', message: 'Ese usuario ya no existe.' }, 404)
      }
      // Si era un local, su actividad ya está cerrada: el borrado se puede repetir.
      log.error('delete_user_failed', { error: deleteError.message, partner_closed: isPartner })
      return json({ error: 'delete_failed', message: 'No se ha podido eliminar el usuario. Vuelve a intentarlo.' }, 500)
    }

    log.info('user_deleted', { was_partner: isPartner })
    return json({ message: 'User deleted successfully', closed_partner: isPartner })
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.code, message: error.status === 401 ? 'Sesión no válida.' : error.code }, error.status)
    }
    logger.error('delete-user failed', { error: String(error) })
    return json({ error: 'internal_error' }, 500)
  }
})
