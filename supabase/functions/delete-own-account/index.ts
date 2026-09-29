// Pasify · delete-own-account
// Borra la cuenta del usuario que llama (guía 5.1.1(v) de Apple). La invoca
// Ajustes (shared/SettingsSheet). Lo que se borra y lo que se conserva lo
// explica public/eliminar-cuenta.html: tiene que seguir coincidiendo.
//
// Body (opcional): { apple_authorization_code?: string } — en iOS, si la
// cuenta tiene Apple, Ajustes pide a Apple un code nuevo para revocar el
// acceso (apple.ts explica por qué hace falta).
//
// En orden, y sin tocar nada hasta que se sabe que se puede borrar:
//   1. Administrador de plataforma → 409 admin_account (su baja es manual).
//   2. Reembolso en curso (pending, approved o processing) → 409
//      refund_in_progress: la solicitud cuelga de la cuenta (ON DELETE
//      CASCADE) y desaparecería a medias.
//   3. Local (rol partner): partner_close_account con SU JWT (usa auth.uid()):
//      cancela sus eventos futuros sin ventas, cierra sus organizaciones y
//      desactiva a los miembros. Con eventos futuros con entradas vendidas se
//      niega → 409 partner_has_upcoming_sales.
//   4. Sus ficheros de Storage (storage.ts). Si Storage falla, 500 y no se
//      borra la cuenta: se puede reintentar.
//   5. Sign in with Apple: se revoca si hay code y secretos; si no, queda en
//      el log y se sigue (nunca bloquea).
//   6. Se borra el usuario de auth (y en cascada su perfil y lo que cuelga de él).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin, requireUser, userClientFrom } from "../_shared/supabase.ts";
import { HttpError } from "../_shared/internal-auth.ts";
import { logger } from "../_shared/logger.ts";
import { revokeAppleWithCode } from "./apple.ts";
import { borrarFicherosDelUsuario } from "./storage.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

/** Estados de refund_requests que aún no han terminado. */
const REEMBOLSO_EN_CURSO = ['pending', 'approved', 'processing']

interface Identidad {
  id?: string
  provider?: string
  identity_data?: { sub?: unknown } | null
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const user = await requireUser(req)
    const log = logger.child({ function: 'delete-own-account', user_id: user.id })

    const body = (await req.json().catch(() => ({}))) as { apple_authorization_code?: unknown }
    const appleCode =
      typeof body?.apple_authorization_code === 'string' && body.apple_authorization_code.length <= 2048
        ? body.apple_authorization_code.trim() || null
        : null

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

    // Reembolsos que aún se están tramitando. Tampoco puede fallar abierto.
    const { data: enCurso, error: refundsError } = await supabaseAdmin
      .from('refund_requests')
      .select('id')
      .eq('requester_user_id', user.id)
      .in('status', REEMBOLSO_EN_CURSO)
      .limit(1)
    if (refundsError) {
      log.error('refund_requests_lookup_failed', { error: refundsError.message })
      return json({ error: 'internal_error' }, 500)
    }
    if ((enCurso ?? []).length > 0) {
      log.info('delete_blocked_refund_in_progress')
      return json({
        error: 'refund_in_progress',
        message:
          'Tienes una devolución en curso. Cuando se resuelva (te avisamos por email) podrás eliminar la cuenta; si la borras ahora, la solicitud se perdería.',
      }, 409)
    }

    // Identidades (Apple). Si no se pueden leer se sigue: solo sirven para revocar.
    let apple: Identidad | null = null
    const { data: completo, error: identitiesError } = await supabaseAdmin.auth.admin.getUserById(user.id)
    if (identitiesError) {
      log.warn('identities_lookup_failed', { error: identitiesError.message })
    } else {
      apple = ((completo?.user?.identities ?? []) as Identidad[]).find((i) => i.provider === 'apple') ?? null
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

    // Foto de perfil y demás ficheros suyos.
    try {
      const borrados = await borrarFicherosDelUsuario(user.id)
      log.info('storage_cleaned', { borrados })
    } catch (storageError) {
      log.error('storage_cleanup_failed', { error: String((storageError as Error)?.message ?? storageError) })
      return json({
        error: 'storage_cleanup_failed',
        message: 'No hemos podido borrar tus archivos (la foto de perfil). No se ha borrado la cuenta: vuelve a intentarlo en unos minutos.',
      }, 500)
    }

    // Sign in with Apple: revocar el acceso de Pasify a su Apple ID.
    if (apple) {
      const appleSub = typeof apple.identity_data?.sub === 'string' ? apple.identity_data.sub : apple.id ?? null
      const revocado = await revokeAppleWithCode(appleCode, appleSub)
      if (revocado.status === 'revoked') log.info('apple_token_revoked')
      else log.warn('apple_revoke_not_done', { result: revocado })
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

    log.info('account_deleted', { was_partner: isPartner, had_apple: apple !== null })
    return json({ message: 'Account deleted successfully' })
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code }, error.status)
    logger.error('delete-own-account failed', { error: String(error) })
    return json({ error: 'internal_error' }, 500)
  }
})
