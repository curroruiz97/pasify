import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Loader2, X, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

interface EditProfileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: any;
  onSaved: () => void;
}

const COMMON_ALLERGENS_KEYS = [
  "gluten", "lactose", "treeNuts", "eggs",
  "fish", "shellfish", "soy", "peanuts"
];

const EditProfileSheet = ({ open, onOpenChange, profile, onSaved }: EditProfileSheetProps) => {
  const { t } = useTranslation();

  const commonAllergens = COMMON_ALLERGENS_KEYS.map(key => t(`allergensList.${key}`));
  const { toast } = useToast();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
  const [allergens, setAllergens] = useState<string[]>([]);
  const [allergenInput, setAllergenInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && profile) {
      setFirstName(profile.first_name || "");
      setLastName(profile.last_name || "");
      setBio(profile.business_description || "");
      setPhone(profile.phone || "");
      setAllergens(profile.allergens || []);
      setAllergenInput("");
    }
  }, [open, profile]);

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

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          business_description: bio.trim() || null,
          phone: phone.trim() || null,
          allergens,
        })
        .eq("id", user.id);

      if (error) throw error;

      toast({
        title: t("common.success"),
        description: t("success.profileUpdated"),
      });

      onSaved();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error saving profile:", error);
      toast({
        title: t("common.error"),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
          onClick={() => onOpenChange(false)}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-lg font-bold flex-1">
          {t("profile.editInfo")}
        </h1>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-5 pb-6">
          {/* First Name */}
          <div className="space-y-2">
            <Label htmlFor="firstName">{t("auth.firstName")}</Label>
            <Input
              id="firstName"
              className="ios-input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder={t("auth.firstName")}
            />
          </div>

          {/* Last Name */}
          <div className="space-y-2">
            <Label htmlFor="lastName">{t("auth.lastName")}</Label>
            <Input
              id="lastName"
              className="ios-input"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder={t("auth.lastName")}
            />
          </div>

          {/* Bio */}
          <div className="space-y-2">
            <Label htmlFor="bio">{t("profile.bio")}</Label>
            <Textarea
              id="bio"
              className="ios-input resize-none"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder={t("profile.addBio")}
              rows={3}
              maxLength={150}
            />
          </div>

          {/* Phone */}
          <div className="space-y-2">
            <Label htmlFor="phone">{t("settings.phone")}</Label>
            <Input
              id="phone"
              className="ios-input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t("settings.phone")}
            />
          </div>

          {/* Allergens */}
          <div className="space-y-2">
            <Label>{t("settings.allergens")}</Label>

            {/* Current allergens */}
            {allergens.length > 0 ? (
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
            ) : (
              <p className="text-xs text-muted-foreground">{t("settings.noAllergens")}</p>
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
          </div>

        </div>
      </div>

      {/* Fixed Footer Buttons */}
      <div className="flex-shrink-0 flex gap-2 p-4 border-t bg-background">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => onOpenChange(false)}
        >
          {t("common.cancel")}
        </Button>
        <Button
          className="flex-1 ios-button"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            t("common.save")
          )}
        </Button>
      </div>
    </div>
  );
};

export default EditProfileSheet;
