// Pasify · delete-own-account
// Borra la cuenta del usuario que llama (guía 5.1.1(v) de Apple). La invocan
// los paneles de ajustes (shared/SettingsSheet, client y partner).
//
// Si es local (rol partner), antes de borrar nada cierra su actividad con la
// RPC partner_close_account, llamada con SU JWT porque usa auth.uid(): cancela
// sus eventos futuros sin ventas, cierra sus organizaciones y desactiva a los
// miembros. Si tiene eventos futuros con entradas vendidas la RPC se niega
// (partner_has_upcoming_sales) y respondemos 409 sin tocar la cuenta.
// Los clientes siguen como siempre: se borra el usuario de auth y listo.
// Una cuenta de administrador de plataforma (rol admin) no se borra desde la
// app: respondemos 409 y su baja se gestiona a mano.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin, requireUser, userClientFrom } from "../_shared/supabase.ts";
import { HttpError } from "../_shared/internal-auth.ts";
import { logger } from "../_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const user = await requireUser(req)
    const log = logger.child({ function: 'delete-own-account', user_id: user.id })

    // Roles con el cliente admin (un usuario puede tener varias filas). Si la
    // consulta falla no se borra nada: el control de admin no puede fallar abierto.
    const { data: roles, error: rolesError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
    if (rolesError) {
      log.error('user_roles_lookup_failed', { error: rolesError.message })
      return json({ error: 'internal_error' }, 500)
    }
    const userRoles = (roles ?? []) as Array<{ role: string }>

    if (userRoles.some((r) => r.role === 'admin')) {
      log.warn('delete_blocked_admin_account')
      return json({
        error: 'admin_account',
        message: 'Una cuenta de administrador no se puede borrar desde la app.',
      }, 409)
    }

    const isPartner = userRoles.some((r) => r.role === 'partner')

    if (isPartner) {
      const { data: closed, error: closeError } = await userClientFrom(req).rpc('partner_close_account')
      if (closeError) {
        const detail = `${closeError.message ?? ''} ${closeError.details ?? ''} ${closeError.hint ?? ''}`
        if (detail.includes('partner_has_upcoming_sales')) {
          log.info('delete_blocked_upcoming_sales')
          return json({
            error: 'partner_has_upcoming_sales',
            message: 'Tienes eventos con entradas vendidas. Cancélalos y reembolsa antes de borrar la cuenta, o escríbenos a soporte.',
          }, 409)
        }
        log.error('partner_close_account_failed', { error: closeError.message, code: closeError.code })
        return json({
          error: 'partner_close_failed',
          message: 'No hemos podido cerrar tu cuenta de local. Inténtalo de nuevo o escríbenos a soporte.',
        }, 500)
      }
      log.info('partner_account_closed', { result: closed })
    }

    // Delete the user's own account using service role
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id)

    if (deleteError) {
      log.error('delete_user_failed', { error: deleteError.message })
      return json({
        error: 'delete_failed',
        message: 'No hemos podido borrar la cuenta. Inténtalo de nuevo o escríbenos a soporte.',
      }, 500)
    }

    log.info('account_deleted', { was_partner: isPartner })
    return json({ message: 'Account deleted successfully' })
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code }, error.status)
    logger.error('delete-own-account failed', { error: String(error) })
    return json({ error: 'internal_error' }, 500)
  }
})
