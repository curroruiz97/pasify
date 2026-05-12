import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { haptic } from "@/lib/haptics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, ScanLine, Camera, X, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import QrScanner from "qr-scanner";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Admin universal QR scanner. Same UX as the partner QRScanner, but:
 * - NO ownership check: any QR (discount or event) of any partner is
 *   accepted as long as it's still valid (date + daily-limit).
 * - The scan is recorded against the QR's REAL partner_id (read from
 *   the discount/event row), so stats stay clean.
 * - Loyalty stamps are skipped — those are tied to a partner-customer
 *   relationship and shouldn't be triggered when an admin scans at a
 *   gate.
 */
const AdminQRScanner = () => {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showResultDialog, setShowResultDialog] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const qrScannerRef = useRef<QrScanner | null>(null);

  const stopCamera = () => {
    if (qrScannerRef.current) {
      qrScannerRef.current.stop();
      qrScannerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  };

  const handleCloseResultDialog = () => {
    setShowResultDialog(false);
    setResult(null);
    setTimeout(() => {
      if (qrScannerRef.current && scanning) {
        try {
          qrScannerRef.current.start();
        } catch (err) {
          console.error("Error resuming scanner:", err);
        }
      }
    }, 300);
  };

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setScanning(true);
      setTimeout(() => {
        if (videoRef.current) {
          const video = videoRef.current;
          video.muted = true;
          video.playsInline = true;
          video.autoplay = true;
          video.controls = false;
          video.srcObject = stream;
          const qrScanner = new QrScanner(
            video,
            async (r) => {
              const scannedCode = r.data;
              setCode(scannedCode);
              if (scannedCode.length >= 4) {
                qrScanner.stop();
                await handleScan(null, scannedCode);
              }
            },
            {
              returnDetailedScanResult: true,
              highlightScanRegion: true,
              highlightCodeOutline: true,
              maxScansPerSecond: 5,
            }
          );
          qrScannerRef.current = qrScanner;
          qrScanner.start();
          video.onloadedmetadata = async () => {
            try {
              await video.play();
            } catch {
              // ignored: autoplay can be blocked, the fallback below covers it
            }
          };
        }
      }, 100);
    } catch (error) {
      console.error("startCamera error:", error);
    }
  };

  const handleScan = async (
    e: React.FormEvent | null,
    scannedCode?: string
  ) => {
    if (e) e.preventDefault();
    const codeToVerify = scannedCode || code;
    if (!codeToVerify) {
      toast({
        title: t("qrScanner.invalidCode"),
        description: t("qrScanner.enterCode"),
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      // Try exact code first, then uppercase fallback.
      let qrData: any = null;
      const { data: exactMatch } = await supabase
        .from("qr_codes")
        .select("*")
        .eq("code", codeToVerify)
        .maybeSingle();
      if (exactMatch) {
        qrData = exactMatch;
      } else {
        const { data: upperMatch } = await supabase
          .from("qr_codes")
          .select("*")
          .eq("code", codeToVerify.toUpperCase())
          .maybeSingle();
        qrData = upperMatch;
      }

      if (!qrData) {
        setResult({ valid: false, message: t("qrScanner.notValid") });
        setShowResultDialog(true);
        return;
      }

      let title = "";
      let discountPercentage = 0;
      let endDate: Date;
      let isEventQR = false;
      let dailyLimit = 1;
      let scansUsedToday = 0;
      // We capture the REAL partner_id from the discount/event row so the
      // scan record is attributed correctly even when the admin isn't
      // the partner.
      let realPartnerId: string | null = null;
      let partnerName = "";

      if (qrData.discount_id) {
        const { data: discount } = await supabase
          .from("discounts")
          .select("*")
          .eq("id", qrData.discount_id)
          .single();
        if (!discount) {
          setResult({ valid: false, message: t("qrScanner.notValid") });
          setShowResultDialog(true);
          return;
        }
        if (discount.allowed_days && discount.allowed_days.length > 0) {
          const todayDay = String(new Date().getDay());
          if (!discount.allowed_days.includes(todayDay)) {
            setResult({ valid: false, message: t("qrScanner.dayNotAllowed") });
            setShowResultDialog(true);
            return;
          }
        }
        dailyLimit = discount.daily_scan_limit || 1;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayISO = today.toISOString();
        const { count } = await supabase
          .from("discount_scans")
          .select("*", { count: "exact", head: true })
          .eq("qr_code_id", qrData.id)
          .gte("scanned_at", todayISO);
        scansUsedToday = count || 0;
        if (scansUsedToday >= dailyLimit) {
          setResult({
            valid: false,
            message: t("qrScanner.dailyLimitReached"),
            details: t("qrScanner.dailyLimitReachedDesc", { limit: dailyLimit }),
          });
          setShowResultDialog(true);
          return;
        }
        title = discount.title;
        discountPercentage = discount.discount_percentage;
        endDate = new Date(discount.end_date);
        realPartnerId = discount.partner_id;
      } else if (qrData.event_id) {
        const { data: event } = await supabase
          .from("events")
          .select("*")
          .eq("id", qrData.event_id)
          .single();
        if (!event) {
          setResult({ valid: false, message: t("qrScanner.notValid") });
          setShowResultDialog(true);
          return;
        }
        const startDate = new Date(event.start_date);
        const oneHourBeforeStart = new Date(startDate.getTime() - 60 * 60 * 1000);
        if (new Date() < oneHourBeforeStart) {
          setResult({
            valid: false,
            message: t("qrScanner.eventNotStarted"),
            details: t("qrScanner.eventStartsAt", {
              date: startDate.toLocaleString(),
            }),
          });
          setShowResultDialog(true);
          return;
        }
        dailyLimit = event.daily_scan_limit || 1;
        const eventToday = new Date();
        eventToday.setHours(0, 0, 0, 0);
        const { count } = await supabase
          .from("discount_scans")
          .select("*", { count: "exact", head: true })
          .eq("qr_code_id", qrData.id)
          .eq("event_id", qrData.event_id)
          .gte("scanned_at", eventToday.toISOString());
        scansUsedToday = count || 0;
        if (scansUsedToday >= dailyLimit) {
          setResult({
            valid: false,
            message: t("qrScanner.dailyLimitReached"),
            details: t("qrScanner.dailyLimitReachedDesc", { limit: dailyLimit }),
          });
          setShowResultDialog(true);
          return;
        }
        title = event.title;
        discountPercentage = event.discount_percentage || 0;
        endDate = new Date(event.end_date);
        isEventQR = true;
        realPartnerId = event.partner_id;
      } else {
        setResult({ valid: false, message: t("qrScanner.notValid") });
        setShowResultDialog(true);
        return;
      }

      if (new Date() > endDate!) {
        setResult({ valid: false, message: t("qrScanner.expired") });
        setShowResultDialog(true);
        return;
      }

      // Fetch partner name for the success dialog.
      if (realPartnerId) {
        const { data: p } = await supabase
          .from("profiles")
          .select("business_name, first_name, last_name")
          .eq("id", realPartnerId)
          .single();
        partnerName =
          p?.business_name ||
          [p?.first_name, p?.last_name].filter(Boolean).join(" ") ||
          "";
      }

      // Record the scan with the REAL partner_id.
      const scanRow: any = {
        qr_code_id: qrData.id,
        client_id: qrData.client_id,
        partner_id: realPartnerId,
        scanned_at: new Date().toISOString(),
      };
      if (isEventQR) scanRow.event_id = qrData.event_id;
      else scanRow.discount_id = qrData.discount_id;
      const { error: scanError } = await supabase
        .from("discount_scans")
        .insert(scanRow);
      if (scanError) {
        console.error("Error recording scan:", scanError);
        setResult({ valid: false, message: t("qrScanner.validationError") });
        setShowResultDialog(true);
        return;
      }
      await supabase
        .from("qr_codes")
        .update({ used_at: new Date().toISOString() })
        .eq("id", qrData.id);

      const remaining = dailyLimit > 1 ? dailyLimit - (scansUsedToday + 1) : null;
      setResult({
        valid: true,
        message: t("qrScanner.valid"),
        details: {
          event: title,
          discount: discountPercentage,
          partner: partnerName,
          scansRemaining: remaining,
          dailyLimit: dailyLimit > 1 ? dailyLimit : null,
        },
      });
      haptic.success();
      setShowResultDialog(true);
      setCode("");
    } catch (error) {
      console.error("Errore verifica:", error);
      setResult({ valid: false, message: t("qrScanner.verificationError") });
      haptic.error();
      setShowResultDialog(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="ios-card p-6">
        <div className="mb-6 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t("admin.scannerUniversal", "Scanner universal admin")}
          </div>
          <ScanLine className="mx-auto mb-4 h-16 w-16 animate-pulse text-primary" />
          <h2 className="mb-2 text-xl font-bold">
            {t("qrScanner.title", "Escanea cualquier QR")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "admin.scannerDescription",
              "Valida los QR de cualquier socio — eventos y descuentos. La scan se registra al partner_id reale del codice."
            )}
          </p>
        </div>

        {scanning ? (
          <div className="space-y-4">
            <div className="relative overflow-hidden rounded-lg bg-black">
              <video
                ref={videoRef}
                className="h-[400px] w-full object-cover"
                playsInline
                muted
                autoPlay
                style={{ backgroundColor: "#000" }}
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-64 w-64 rounded-lg border-4 border-white/50" />
              </div>
            </div>
            <Button onClick={stopCamera} variant="outline" className="w-full" size="lg">
              <X className="mr-2 h-4 w-4" />
              {t("qrScanner.closeCamera")}
            </Button>
          </div>
        ) : (
          <Button
            onClick={startCamera}
            className="mb-4 h-14 w-full bg-gradient-to-br from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
            size="lg"
            type="button"
          >
            <Camera className="mr-2 h-5 w-5" />
            {t("qrScanner.openCamera")}
          </Button>
        )}

        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">
              {scanning ? t("qrScanner.orManual") : t("qrScanner.orOther")}
            </span>
          </div>
        </div>

        <form onSubmit={(e) => handleScan(e)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="admin-qr-code-input">
              {t("qrScanner.enterManually")}
            </Label>
            <Input
              id="admin-qr-code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="XXXXXXXXXXXX"
              maxLength={32}
              className="ios-input text-center font-mono text-2xl tracking-wider"
            />
          </div>
          <Button
            type="submit"
            className="ios-button h-14 w-full text-lg"
            disabled={loading || !code}
            size="lg"
          >
            {loading ? t("qrScanner.verifying") : t("qrScanner.verify")}
          </Button>
        </form>
      </div>

      <Dialog open={showResultDialog} onOpenChange={handleCloseResultDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="sr-only">
              {result?.valid ? t("qrScanner.valid") : t("qrScanner.invalidCode")}
            </DialogTitle>
          </DialogHeader>
          {result && (
            <div
              className={`rounded-lg p-6 ${
                result.valid ? "bg-green-500/10" : "bg-destructive/10"
              }`}
            >
              <div className="flex flex-col items-center gap-4 text-center">
                {result.valid ? (
                  <CheckCircle2 className="h-20 w-20 text-green-500" />
                ) : (
                  <XCircle className="h-20 w-20 text-destructive" />
                )}
                <h3
                  className={`text-2xl font-bold ${
                    result.valid ? "text-green-600" : "text-destructive"
                  }`}
                >
                  {result.message}
                </h3>
                {result.details && typeof result.details === "object" && (
                  <div className="space-y-1 text-base">
                    {result.details.partner && (
                      <p className="text-sm text-muted-foreground">
                        {result.details.partner}
                      </p>
                    )}
                    <p>
                      <span className="font-semibold">
                        {t("qrScanner.event")}
                      </span>{" "}
                      {result.details.event}
                    </p>
                    {result.details.discount > 0 && (
                      <p>
                        <span className="font-semibold">
                          {t("qrScanner.discount")}
                        </span>{" "}
                        {result.details.discount}%
                      </p>
                    )}
                    {result.details.scansRemaining != null &&
                      result.details.dailyLimit && (
                        <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                          {t("qrScanner.scansRemaining", {
                            remaining: result.details.scansRemaining,
                            limit: result.details.dailyLimit,
                          })}
                        </p>
                      )}
                  </div>
                )}
                {result.details && typeof result.details === "string" && (
                  <p className="text-sm text-muted-foreground">
                    {result.details}
                  </p>
                )}
                <Button
                  onClick={handleCloseResultDialog}
                  className="mt-4 h-12 w-full text-lg"
                  variant={result.valid ? "default" : "destructive"}
                >
                  {t("common.close")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminQRScanner;
