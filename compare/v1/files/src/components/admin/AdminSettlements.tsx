import { Fragment, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, Landmark, Loader2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PasifyDateInput } from "@/components/ui/pasify-date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { useToast } from "@/hooks/use-toast";
import { qk } from "@/lib/cache/keys";
import { getErrorMessage } from "@/lib/sentry";
import {
  orgSuspendida,
  useAdminOrgSettlements,
  useAdminSettlementOverview,
  type SettlementOverviewRow,
} from "./adminQueries";
import { registrarLiquidacion } from "./adminActions";
import { centimosDe, euros, fecha, fechaHora, hoyIso, mono } from "./adminFormat";
import { Chip, ErrorCard, Eyebrow } from "./AdminUi";

/* ============================================================================
   Liquidaciones (B5-4). Pasify cobra las entradas por los locales que aún no
   cobran con su propio Stripe y les transfiere lo suyo a mano. Por cada
   organización: bruto, reembolsos, comisión y neto (partner_balance_v, sin
   pagos de prueba mientras require_live_payments), lo ya liquidado
   (partner_settlements) y lo pendiente. «Registrar» apunta una
   transferencia hecha; el historial sale al desplegar la fila.
   Un local suspendido no se liquida (D-8): el servidor lo rechaza.
   ============================================================================ */

const PAGE_SIZE = 25;

const AVISO_CONNECT =
  "Tiene pedidos cobrados con su propia cuenta de Stripe: ese dinero ya le llegó directamente, pero el neto de aquí lo incluye. Descuéntalo antes de transferir.";

/** Lo tecleado en el buscador, 300 ms después de dejar de escribir. */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const colorPendiente = (cents: number) => (cents > 0 ? "#FF7A4D" : cents < 0 ? "#E5484D" : undefined);

export const AdminSettlements = ({ uid }: { uid: string | null }) => {
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const [soloPendiente, setSoloPendiente] = useState(false);
  const [page, setPage] = useState(0);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState<SettlementOverviewRow | null>(null);
  const search = useDebounced(texto.trim());

  const resumen = useAdminSettlementOverview(uid, { search, onlyPending: soloPendiente, page, pageSize: PAGE_SIZE });
  const filas = resumen.data?.rows ?? [];
  const total = resumen.data?.total ?? 0;
  const totales = resumen.data?.totals;

  // Otro filtro: de vuelta a la primera página.
  useEffect(() => setPage(0), [search, soloPendiente]);
  const paginaVacia = !resumen.isFetching && !!resumen.data && filas.length === 0 && page > 0;
  useEffect(() => {
    if (paginaVacia) setPage((p) => Math.max(0, p - 1));
  }, [paginaVacia]);

  const refrescar = () => {
    if (uid) void queryClient.invalidateQueries({ queryKey: qk.admin.settlements(uid) });
  };

  const desde = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const hasta = Math.min(total, (page + 1) * PAGE_SIZE);
  const hayFiltros = !!search || soloPendiente;

  return (
    <div>
      <h1 className="mb-1 text-3xl font-bold tracking-tight">Liquidaciones</h1>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Lo que Pasify ha cobrado por cada local, lo que ya le ha transferido y lo que aún le debe. Cuando hagas una
        transferencia, apúntala con «Registrar».
      </p>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Resumen etiqueta="Neto de las ventas" valor={totales?.net ?? null} />
        <Resumen etiqueta="Ya liquidado" valor={totales?.settled ?? null} />
        <Resumen etiqueta="Pendiente de liquidar" valor={totales?.pending ?? null} destacado />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-border p-3 md:flex-row md:items-center md:p-4">
            <Input
              placeholder="Buscar local o email del dueño…"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="h-10 rounded-xl md:max-w-sm"
              aria-label="Buscar locales"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={soloPendiente} onCheckedChange={setSoloPendiente} aria-label="Solo con saldo pendiente" />
              Solo con saldo pendiente
            </label>
            <Button
              variant="ghost"
              size="sm"
              className="md:ml-auto"
              onClick={refrescar}
              disabled={resumen.isFetching}
              aria-label="Refrescar"
            >
              <RefreshCw className={`h-4 w-4 ${resumen.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {resumen.isError ? (
            <ErrorCard
              className="m-4"
              mensaje={`No se han podido cargar las liquidaciones: ${getErrorMessage(resumen.error)}`}
              onRetry={() => void resumen.refetch()}
            />
          ) : resumen.isPending ? (
            <PasifyEmptyState icon={<Landmark className="h-7 w-7" />} eyebrow="Cargando" title="Cargando saldos…" spin compact />
          ) : filas.length === 0 ? (
            <PasifyEmptyState
              icon={<Landmark className="h-7 w-7" />}
              eyebrow={hayFiltros ? "Sin resultados" : "Sin ventas"}
              title={hayFiltros ? "Ningún local coincide con el filtro." : "Aún no hay ventas que liquidar."}
              subtitle={hayFiltros ? undefined : "Cuando un local venda entradas cobradas por Pasify, aparecerá aquí."}
              compact
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Local</TableHead>
                      <TableHead className="text-right">Bruto</TableHead>
                      <TableHead className="text-right">Reembolsos</TableHead>
                      <TableHead className="text-right">Comisión</TableHead>
                      <TableHead className="text-right">Neto</TableHead>
                      <TableHead className="text-right">Liquidado</TableHead>
                      <TableHead className="text-right">Pendiente</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filas.map((r) => {
                      const desplegada = abierta === r.org_id;
                      const suspendida = orgSuspendida({ status: r.org_status, suspended_at: r.suspended_at });
                      return (
                        <Fragment key={r.org_id}>
                          <TableRow>
                            <TableCell className="pr-0">
                              <button
                                type="button"
                                onClick={() => setAbierta(desplegada ? null : r.org_id)}
                                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                aria-label={desplegada ? "Ocultar historial" : "Ver historial"}
                                aria-expanded={desplegada}
                              >
                                {desplegada ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{r.org_name}</span>
                                {suspendida && <Chip color="#E5484D">Suspendido</Chip>}
                                {r.org_status === "closed" && <Chip color="#8A8275">Cerrado</Chip>}
                                {r.connect_orders > 0 && (
                                  <span title={AVISO_CONNECT}>
                                    <Chip color="#8FB8DE">Cobra con su Stripe · {r.connect_orders}</Chip>
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {r.owner_email ?? "Sin dueño"} · {r.paid_orders} {r.paid_orders === 1 ? "pedido" : "pedidos"}
                                {r.last_paid_at ? ` · última transferencia ${fecha(r.last_paid_at)}` : ""}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{euros(r.gross_cents)}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {r.refunded_cents > 0 ? `−${euros(r.refunded_cents)}` : euros(0)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {r.fee_cents > 0 ? `−${euros(r.fee_cents)}` : euros(0)}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">{euros(r.net_cents)}</TableCell>
                            <TableCell className="text-right tabular-nums">{euros(r.settled_cents)}</TableCell>
                            <TableCell
                              className="text-right font-semibold tabular-nums"
                              style={{ color: colorPendiente(r.pending_cents) }}
                              title={r.pending_cents < 0 ? "Pasify ha transferido más de lo que le corresponde" : undefined}
                            >
                              {euros(r.pending_cents)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right">
                              <Button
                                size="sm"
                                variant={r.pending_cents > 0 ? "default" : "outline"}
                                disabled={suspendida}
                                title={suspendida ? "Un local suspendido no se liquida hasta que se reactive" : "Apuntar una transferencia hecha"}
                                onClick={() => setRegistrando(r)}
                              >
                                <Plus className="mr-1 h-3.5 w-3.5" />
                                Registrar
                              </Button>
                            </TableCell>
                          </TableRow>
                          {desplegada && (
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableCell />
                              <TableCell colSpan={8}>
                                <Historial uid={uid} fila={r} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div
                className="flex items-center justify-between border-t border-border px-4 py-3 text-[11px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.14em" }}
              >
                <span>
                  {desde}–{hasta} de {total.toLocaleString("es-ES")}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                    Anterior
                  </Button>
                  <Button variant="outline" size="sm" disabled={hasta >= total} onClick={() => setPage((p) => p + 1)}>
                    Siguiente
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 max-w-3xl text-xs text-muted-foreground">
        Neto = cobrado − reembolsos − comisión de Pasify. Los pagos de prueba de Stripe no cuentan. Un pendiente en
        negativo es dinero transferido de más. Los locales que cobran con su propio Stripe reciben el dinero
        directamente: no hay que liquidarles.
      </p>

      <RegisterDialog
        fila={registrando}
        onClose={() => setRegistrando(null)}
        onDone={(orgId) => {
          refrescar();
          setAbierta(orgId);
        }}
      />
    </div>
  );
};

const Resumen = ({ etiqueta, valor, destacado }: { etiqueta: string; valor: number | null; destacado?: boolean }) => (
  <Card>
    <CardContent className="p-5">
      <Eyebrow className="mb-2">{etiqueta}</Eyebrow>
      <div
        className="text-2xl font-bold tabular-nums"
        style={{ color: destacado && valor !== null ? colorPendiente(valor) : undefined }}
      >
        {valor === null ? "—" : euros(valor)}
      </div>
    </CardContent>
  </Card>
);

const Historial = ({ uid, fila }: { uid: string | null; fila: SettlementOverviewRow }) => {
  const historial = useAdminOrgSettlements(uid, fila.org_id);
  const filas = historial.data ?? [];

  if (historial.isError) {
    return (
      <ErrorCard
        className="my-2"
        mensaje={`No se ha podido cargar el historial: ${getErrorMessage(historial.error)}`}
        onRetry={() => void historial.refetch()}
      />
    );
  }
  if (historial.isPending) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando historial…
      </div>
    );
  }
  if (filas.length === 0) {
    return <p className="py-3 text-sm text-muted-foreground">Aún no se le ha liquidado nada.</p>;
  }
  return (
    <div className="py-2">
      <Eyebrow className="mb-2">Transferencias a {fila.org_name}</Eyebrow>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Fecha</th>
              <th className="px-3 py-2 text-right font-medium">Importe</th>
              <th className="px-3 py-2 font-medium">Referencia</th>
              <th className="px-3 py-2 font-medium">Nota</th>
              <th className="px-3 py-2 font-medium">Apuntada</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((s) => (
              <tr key={s.id} className="border-t border-border align-top">
                <td className="whitespace-nowrap px-3 py-2">{fecha(s.paid_at)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{euros(s.amount_cents, s.currency)}</td>
                <td className="px-3 py-2" style={mono}>
                  {s.bank_reference ?? "—"}
                </td>
                <td className="max-w-[18rem] break-words px-3 py-2 text-muted-foreground">{s.note ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {fechaHora(s.created_at)}
                  {s.created_by_name ? ` · ${s.created_by_name}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** "2026-09-25" → ISO. Hoy: ahora mismo; otro día: a mediodía (sin saltos de día por la zona horaria). */
function fechaTransferencia(dia: string): string {
  if (dia === hoyIso()) return new Date().toISOString();
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

const importeTexto = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

const RegisterDialog = ({
  fila,
  onClose,
  onDone,
}: {
  fila: SettlementOverviewRow | null;
  onClose: () => void;
  onDone: (orgId: string) => void;
}) => {
  const { toast } = useToast();
  const [importe, setImporte] = useState("");
  const [dia, setDia] = useState(hoyIso());
  const [referencia, setReferencia] = useState("");
  const [nota, setNota] = useState("");
  const [deMas, setDeMas] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Al abrir: lo pendiente como importe propuesto.
  useEffect(() => {
    if (!fila) return;
    setImporte(fila.pending_cents > 0 ? importeTexto(fila.pending_cents) : "");
    setDia(hoyIso());
    setReferencia("");
    setNota("");
    setDeMas(false);
    setError(null);
  }, [fila]);

  const cents = centimosDe(importe);
  const pendiente = fila?.pending_cents ?? 0;
  const excede = cents !== null && cents > pendiente;
  const futura = dia > hoyIso();
  const valido =
    !!fila && cents !== null && cents > 0 && referencia.trim().length >= 3 && !!dia && !futura && (!excede || deMas);

  const cerrar = () => {
    if (!trabajando) onClose();
  };

  const confirmar = async () => {
    if (!fila || !valido || cents === null) return;
    setTrabajando(true);
    setError(null);
    try {
      const r = await registrarLiquidacion({
        orgId: fila.org_id,
        amountCents: cents,
        paidAt: fechaTransferencia(dia),
        reference: referencia.trim(),
        note: nota.trim() || null,
        allowExcess: deMas,
      });
      if (r.ok === false) {
        setError(r.mensaje);
        return;
      }
      toast({ title: "Liquidación registrada", description: `${euros(cents)} a ${fila.org_name}. Le hemos avisado en su panel.` });
      onDone(fila.org_id);
      onClose();
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Dialog open={!!fila} onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar liquidación · {fila?.org_name ?? ""}</DialogTitle>
          <DialogDescription>
            Apunta una transferencia ya hecha al local. Pendiente ahora: {euros(pendiente)}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="liq-importe" className="text-xs">
              Importe (€)
            </Label>
            <Input
              id="liq-importe"
              inputMode="decimal"
              value={importe}
              onChange={(e) => setImporte(e.target.value)}
              placeholder="0,00"
              className="tabular-nums"
              disabled={trabajando}
            />
            {importe && cents === null && <p className="text-xs text-destructive">Importe no válido.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="liq-fecha" className="text-xs">
              Fecha de la transferencia
            </Label>
            <PasifyDateInput id="liq-fecha" value={dia} onChange={setDia} disabled={trabajando} />
            {futura && <p className="text-xs text-destructive">No puede ser una fecha futura.</p>}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="liq-referencia" className="text-xs">
            Referencia bancaria
          </Label>
          <Input
            id="liq-referencia"
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="Concepto o referencia de la transferencia"
            maxLength={140}
            disabled={trabajando}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="liq-nota" className="text-xs">
            Nota interna (opcional)
          </Label>
          <Textarea
            id="liq-nota"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={2}
            maxLength={1000}
            disabled={trabajando}
          />
        </div>

        {fila && fila.connect_orders > 0 && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            {AVISO_CONNECT}
          </p>
        )}

        {excede && (
          <label className="flex items-start gap-2 rounded-xl border p-3 text-sm" style={{ borderColor: "rgba(229,72,77,0.45)" }}>
            <Checkbox checked={deMas} onCheckedChange={(v) => setDeMas(v === true)} className="mt-0.5" />
            <span>
              <span className="font-medium">Supera lo pendiente ({euros(pendiente)}).</span> Márcalo solo si de verdad se
              transfirió más: el local quedará con saldo negativo.
            </span>
          </label>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm" style={{ color: "#E5484D" }}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={cerrar} disabled={trabajando}>
            Cancelar
          </Button>
          <Button disabled={!valido || trabajando} onClick={() => void confirmar()}>
            {trabajando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Registrar {cents ? euros(cents) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AdminSettlements;
