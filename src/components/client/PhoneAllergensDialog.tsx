import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface PhoneAllergensDialogProps {
  open: boolean;
  currentUserId: string;
  initialPhone?: string;
  initialAllergens?: string[];
  requireAllergens?: boolean;
  onConfirm: () => void;
}

const COMMON_ALLERGENS_KEYS = [
  "gluten", "lactose", "treeNuts", "eggs",
  "fish", "shellfish", "soy", "peanuts"
];

const PhoneAllergensDialog = ({
  open,
  currentUserId,
  initialPhone = "",
  initialAllergens = [],
  requireAllergens = true,
  onConfirm,
}: PhoneAllergensDialogProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();

  const commonAllergens = COMMON_ALLERGENS_KEYS.map(key => t(`allergensList.${key}`));

  const [phone, setPhone] = useState(initialPhone);
  const [allergens, setAllergens] = useState<string[]>(initialAllergens);
  const [allergenInput, setAllergenInput] = useState("");
  const [noAllergies, setNoAllergies] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sincronizza lo stato quando il dialog si apre con nuovi dati
  useEffect(() => {
    if (open) {
      setPhone(initialPhone);
      setAllergens(initialAllergens);
      setNoAllergies(false);
      setAllergenInput("");
    }
  }, [open, initialPhone, initialAllergens]);

  const addAllergen = (allergen: string) => {
    const trimmed = allergen.trim();
    if (trimmed && !allergens.includes(trimmed)) {
      setAllergens([...allergens, trimmed]);
    }
    setAllergenInput("");
  };

  const removeAllergen = (allergen: string) => {
    setAllergens(allergens.filter(a => a !== allergen));
  };

  const isValid = phone.trim().length > 0 && (!requireAllergens || noAllergies || allergens.length > 0);

  const handleConfirm = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      const updateData: Record<string, any> = { phone: phone.trim() };
      if (requireAllergens) {
        updateData.allergens = noAllergies ? [] : allergens;
      }
      const { error } = await supabase
        .from("profiles")
        .update(updateData)
        .eq("id", currentUserId);

      if (error) throw error;

      onConfirm();
    } catch (error: any) {
      console.error("[PhoneAllergensDialog] Error saving profile:", error);
      toast({
        title: t("common.error"),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} modal>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className={cn(
            "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
            "max-h-[90vh] overflow-y-auto"
          )}
        >
          <DialogHeader>
            <DialogTitle>{t("events.completeProfile")}</DialogTitle>
            <DialogDescription>{t("events.completeProfileDesc")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="dialog-phone">{t("settings.phone")} *</Label>
              <Input
                id="dialog-phone"
                type="tel"
                className="ios-input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("settings.phone")}
              />
            </div>

            {/* Allergens - only for dinner events */}
            {requireAllergens && (
              <div className="space-y-2">
                <Label>{t("settings.allergens")} *</Label>

                {/* No allergies checkbox */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="no-allergies"
                    checked={noAllergies}
                    onCheckedChange={(checked) => {
                      setNoAllergies(checked === true);
                      if (checked) setAllergens([]);
                    }}
                  />
                  <label
                    htmlFor="no-allergies"
                    className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {t("events.noAllergies")}
                  </label>
                </div>

                {!noAllergies && (
                  <>
                    {/* Current allergens */}
                    {allergens.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {allergens.map((allergen) => (
                          <Badge key={allergen} variant="secondary" className="gap-1 pr-1">
                            {allergen}
                            <button
                              type="button"
                              onClick={() => removeAllergen(allergen)}
                              className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Add allergen input */}
                    <div className="flex gap-2">
                      <Input
                        placeholder={t("settings.addAllergen")}
                        value={allergenInput}
                        onChange={(e) => setAllergenInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addAllergen(allergenInput);
                          }
                        }}
                        className="flex-1 ios-input"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => addAllergen(allergenInput)}
                        disabled={!allergenInput.trim()}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Common allergens suggestions */}
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">{t("settings.commonAllergens")}:</p>
                      <div className="flex flex-wrap gap-1">
                        {commonAllergens.filter(a => !allergens.includes(a)).map((allergen) => (
                          <button
                            key={allergen}
                            type="button"
                            onClick={() => addAllergen(allergen)}
                            className="text-xs px-2 py-1 rounded-full border border-dashed border-muted-foreground/30 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                          >
                            + {allergen}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              className="w-full ios-button"
              onClick={handleConfirm}
              disabled={!isValid || saving}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              {t("events.confirmAndJoin")}
            </Button>
          </DialogFooter>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};

export default PhoneAllergensDialog;
