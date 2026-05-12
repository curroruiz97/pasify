import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CreditCard, Gift, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

interface LoyaltyCardConfigProps {
  partnerId: string;
}

const LoyaltyCardConfig = ({ partnerId }: LoyaltyCardConfigProps) => {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [isActive, setIsActive] = useState(false);
  const [rewardDescription, setRewardDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [loyaltyCardId, setLoyaltyCardId] = useState<string | null>(null);

  useEffect(() => {
    fetchLoyaltyCard();
  }, [partnerId]);

  const fetchLoyaltyCard = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("loyalty_cards")
      .select("*")
      .eq("partner_id", partnerId)
      .maybeSingle();

    if (data) {
      setIsActive(data.is_active);
      setRewardDescription(data.reward_description);
      setLoyaltyCardId(data.id);
    }
    setLoading(false);
  };

  const handleToggle = async (checked: boolean) => {
    if (checked && !loyaltyCardId) {
      // Si se activa por primera vez, abrir dialog para configurar
      setShowDialog(true);
      return;
    }

    if (loyaltyCardId) {
      // Actualizar estado
      const { error } = await supabase
        .from("loyalty_cards")
        .update({ is_active: checked })
        .eq("id", loyaltyCardId);

      if (error) {
        toast({
          title: t("common.error"),
          description: t("loyaltyCard.errorUpdating"),
          variant: "destructive",
        });
        return;
      }

      setIsActive(checked);
      toast({
        title: checked ? t("loyaltyCard.activated") : t("loyaltyCard.deactivated"),
      });
    }
  };

  const handleSave = async () => {
    if (!rewardDescription.trim()) {
      toast({
        title: t("common.error"),
        description: t("loyaltyCard.enterReward"),
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    if (loyaltyCardId) {
      // Update existing
      const { error } = await supabase
        .from("loyalty_cards")
        .update({
          reward_description: rewardDescription,
          is_active: true,
        })
        .eq("id", loyaltyCardId);

      if (error) {
        toast({
          title: t("common.error"),
          description: t("loyaltyCard.errorSaving"),
          variant: "destructive",
        });
        setSaving(false);
        return;
      }
    } else {
      // Create new
      const { data, error } = await supabase
        .from("loyalty_cards")
        .insert({
          partner_id: partnerId,
          reward_description: rewardDescription,
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        toast({
          title: t("common.error"),
          description: t("loyaltyCard.errorCreating"),
          variant: "destructive",
        });
        setSaving(false);
        return;
      }

      setLoyaltyCardId(data.id);
    }

    setIsActive(true);
    setSaving(false);
    setShowDialog(false);
    toast({
      title: t("loyaltyCard.saved"),
      description: t("loyaltyCard.savedDescription"),
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-between p-4 bg-gradient-to-r from-primary/10 to-cyan-500/10 rounded-2xl border border-primary/20 animate-pulse">
        <div className="h-6 w-32 bg-muted rounded" />
        <div className="h-6 w-12 bg-muted rounded-full" />
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowDialog(true)}
        className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-primary/10 to-cyan-500/10 rounded-2xl border border-primary/20 hover:border-primary/40 transition-all group"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-primary to-cyan-500 rounded-xl">
            <CreditCard className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <span className="font-semibold text-foreground">{t("loyaltyCard.title")}</span>
            {isActive && rewardDescription && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                🎁 {rewardDescription}
              </p>
            )}
          </div>
        </div>
        <Switch
          checked={isActive}
          onCheckedChange={handleToggle}
          onClick={(e) => e.stopPropagation()}
        />
      </button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader className="text-center pb-4">
            <div className="mx-auto p-4 bg-gradient-to-br from-primary to-cyan-500 rounded-2xl w-fit mb-4">
              <Gift className="w-8 h-8 text-white" />
            </div>
            <DialogTitle className="text-xl font-bold">
              {t("loyaltyCard.configTitle")}
            </DialogTitle>
            <p className="text-sm text-muted-foreground mt-2">
              {t("loyaltyCard.configDescription")}
            </p>
          </DialogHeader>

          <div className="space-y-6">
            {/* Preview de la tarjeta */}
            <div className="relative overflow-hidden bg-gradient-to-br from-primary via-primary/90 to-cyan-500 rounded-2xl p-6 text-white">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/10 rounded-full translate-y-1/2 -translate-x-1/2" />
              
              <div className="relative">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-5 h-5" />
                  <span className="font-bold">{t("loyaltyCard.preview")}</span>
                </div>
                
                {/* Stamps preview */}
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {[...Array(10)].map((_, i) => (
                    <div
                      key={i}
                      className={`aspect-square rounded-full border-2 border-white/50 flex items-center justify-center ${
                        i < 7 ? "bg-white/30" : "bg-transparent"
                      }`}
                    >
                      {i < 7 && <span className="text-sm">✓</span>}
                    </div>
                  ))}
                </div>
                
                <div className="text-sm opacity-90">
                  7/10 {t("loyaltyCard.stamps")}
                </div>
              </div>
            </div>

            {/* Reward configuration */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">
                {t("loyaltyCard.rewardLabel")}
              </Label>
              <Textarea
                placeholder={t("loyaltyCard.rewardPlaceholder")}
                value={rewardDescription}
                onChange={(e) => setRewardDescription(e.target.value)}
                className="min-h-[100px] rounded-xl resize-none"
              />
              <p className="text-xs text-muted-foreground">
                {t("loyaltyCard.rewardHint")}
              </p>
            </div>

            <Button
              onClick={handleSave}
              disabled={saving || !rewardDescription.trim()}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-primary to-cyan-500 hover:opacity-90 transition-opacity"
            >
              {saving ? t("common.loading") : t("loyaltyCard.saveAndActivate")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default LoyaltyCardConfig;
