import { test, expect } from "@playwright/test";

/**
 * Admin grant + RLS hardening: regresión de las migrations 0047 y 0050.
 *
 * Verifica que:
 *  1. Las RPCs admin_* NO son ejecutables por `anon` (mig 0047 — REVOKE
 *     FROM PUBLIC + GRANT solo a authenticated/service_role).
 *  2. La whitelist anon SÍ funciona (accept_invitation/global_search/etc.).
 *  3. Las policies con `(SELECT auth.uid())` cacheado (mig 0050) siguen
 *     filtrando bien — se valida indirectamente: SELECT anon sobre
 *     `partner_subscriptions` con un org_id falso devuelve 0 filas.
 *
 * Estos tests usan REST API anon directamente, no requieren browser ni
 * sesión real.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

test.describe("Admin RPCs · anon execute revoked (mig 0047)", () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY,
    "VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY no definidas",
  );

  test("admin_grant_partner_access rechaza anon", async ({ request }) => {
    const resp = await request.post(
      `${SUPABASE_URL}/rest/v1/rpc/admin_grant_partner_access`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY!,
          "Content-Type": "application/json",
        },
        data: { _user_id: "00000000-0000-0000-0000-000000000000" },
      },
    );
    // Postgres rechaza con permission_denied → PostgREST devuelve 401/403/404.
    expect([401, 403, 404]).toContain(resp.status());
  });

  test("admin_list_users rechaza anon", async ({ request }) => {
    const resp = await request.post(
      `${SUPABASE_URL}/rest/v1/rpc/admin_list_users`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY!,
          "Content-Type": "application/json",
        },
        data: {},
      },
    );
    expect([401, 403, 404]).toContain(resp.status());
  });

  test("admin_grant_partner_access_until rechaza anon", async ({ request }) => {
    const resp = await request.post(
      `${SUPABASE_URL}/rest/v1/rpc/admin_grant_partner_access_until`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY!,
          "Content-Type": "application/json",
        },
        data: {
          _org_id: "00000000-0000-0000-0000-000000000000",
          _until: new Date(Date.now() + 86_400_000).toISOString(),
          _note: "test",
        },
      },
    );
    expect([401, 403, 404]).toContain(resp.status());
  });
});

test.describe("Whitelist anon (mig 0047)", () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY,
    "Env vars no definidas",
  );

  test("get_app_setting_bool SÍ ejecutable por anon", async ({ request }) => {
    const resp = await request.post(
      `${SUPABASE_URL}/rest/v1/rpc/get_app_setting_bool`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY!,
          "Content-Type": "application/json",
        },
        data: { _key: "any-non-existing-key" },
      },
    );
    // Aunque la key no exista, anon DEBE poder ejecutar (200 con null body).
    expect(resp.status()).toBe(200);
  });

  test("global_search SÍ ejecutable por anon", async ({ request }) => {
    const resp = await request.post(
      `${SUPABASE_URL}/rest/v1/rpc/global_search`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY!,
          "Content-Type": "application/json",
        },
        data: { _q: "test", _limit: 5 },
      },
    );
    expect(resp.status()).toBe(200);
  });
});

test.describe("RLS post mig 0050 · partner_subscriptions filtro correcto", () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY,
    "Env vars no definidas",
  );

  test("anon SELECT partner_subscriptions devuelve 0 filas (RLS bloquea)", async ({
    request,
  }) => {
    const resp = await request.get(
      `${SUPABASE_URL}/rest/v1/partner_subscriptions?select=id&limit=1`,
      {
        headers: { apikey: SUPABASE_ANON_KEY! },
      },
    );
    // Anon no tiene auth.uid() → policy con (SELECT auth.uid()) devuelve
    // NULL → fila no matchea → 0 filas. 200 con array vacío es lo esperado.
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });
});
