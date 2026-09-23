// Pasify · delete-user
// Borra la cuenta de otro usuario. Solo admins de plataforma (has_role admin);
// la llama components/admin/UsersManagement.tsx, que lee `error` como string.

import { supabaseAdmin, requireUser, isPlatformAdmin } from "../_shared/supabase.ts";
import { HttpError } from "../_shared/internal-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // OJO: antes se volcaban aquí todas las cabeceras al log, token incluido.
    const user = await requireUser(req)
    if (!(await isPlatformAdmin(user.id))) {
      return json({ error: 'Solo un administrador puede eliminar usuarios' }, 403)
    }

    const { userId } = await req.json()
    // UUID estricto: el id también acaba dentro de un filtro .or() de PostgREST.
    if (!userId || typeof userId !== 'string' || !UUID_RE.test(userId)) {
      return json({ error: 'userId no válido' }, 400)
    }

    if (userId === user.id) {
      return json({ error: 'No puedes eliminar tu propia cuenta desde aquí' }, 400)
    }

    console.log('[delete-user] admin', user.id, 'deleting', userId)

    // Pulisci dati collegati (tablas legacy; si no existen, PostgREST devuelve error y seguimos)
    await supabaseAdmin.from('typing_indicators').delete().eq('user_id', userId)
    await supabaseAdmin.from('favorites').delete().or(`user_id.eq.${userId},favorite_user_id.eq.${userId}`)

    // Elimina l'utente
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)

    if (deleteError) {
      console.error('[delete-user] Delete failed:', deleteError.message)
      return json({ error: 'No se pudo eliminar el usuario' }, 500)
    }

    return json({ message: 'User deleted successfully' })
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.status === 401 ? 'Sesión no válida' : error.code }, error.status)
    }
    console.error('[delete-user] Error:', error)
    return json({ error: 'internal_error' }, 500)
  }
})
