import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    // Admin client con service role per operazioni privilegiate
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // Prova a ottenere l'Authorization header (case-insensitive)
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')

    console.log('[delete-user] Auth header present:', !!authHeader)
    console.log('[delete-user] All headers:', JSON.stringify([...req.headers.entries()]))

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header found' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.replace('Bearer ', '')

    // Verifica l'utente con il token
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token)

    if (authError || !user) {
      console.error('[delete-user] Auth error:', authError?.message)
      return new Response(
        JSON.stringify({ error: 'Auth failed: ' + (authError?.message || 'no user') }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('[delete-user] Caller:', user.id)

    // Verifica ruolo admin
    const { data: roleData } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single()

    if (!roleData) {
      return new Response(
        JSON.stringify({ error: 'Admin role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { userId } = await req.json()
    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'userId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (userId === user.id) {
      return new Response(
        JSON.stringify({ error: 'Cannot delete yourself' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('[delete-user] Deleting:', userId)

    // Pulisci dati collegati
    await adminClient.from('typing_indicators').delete().eq('user_id', userId)
    await adminClient.from('favorites').delete().or(`user_id.eq.${userId},favorite_user_id.eq.${userId}`)

    // Elimina l'utente
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId)

    if (deleteError) {
      console.error('[delete-user] Delete failed:', deleteError.message)
      return new Response(
        JSON.stringify({ error: deleteError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('[delete-user] Success')
    return new Response(
      JSON.stringify({ message: 'User deleted successfully' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[delete-user] Error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
