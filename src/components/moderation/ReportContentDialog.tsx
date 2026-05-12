import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface ReportContentDialogProps {
  contentId: string;
  contentType: "post" | "comment" | "message" | "video";
  trigger?: React.ReactNode;
}

const ReportContentDialog = ({
  contentId,
  contentType,
  trigger,
}: ReportContentDialogProps) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("spam");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  const reasons = [
    { value: "spam", label: t('moderation.reportReasons.spam') },
    { value: "hate_speech", label: t('moderation.reportReasons.hate_speech') },
    { value: "harassment", label: t('moderation.reportReasons.harassment') },
    { value: "violence", label: t('moderation.reportReasons.violence') },
    { value: "inappropriate", label: t('moderation.reportReasons.inappropriate') },
    { value: "other", label: t('moderation.reportReasons.other') },
  ];

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const { error } = await supabase.from("content_flags").insert({
        content_id: contentId,
        content_type: contentType,
        reason,
        description: description.trim() || null,
        reporter_user_id: user.id,
      });

      if (error) throw error;

      toast.success(t('moderation.reportSuccess'));
      setOpen(false);
      setDescription("");
      setReason("spam");
    } catch (error: any) {
      console.error("Error reporting content:", error);
      toast.error(t('moderation.reportError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm">
            <Flag className="w-4 h-4 mr-2" />
            {t('moderation.reportContent')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('moderation.reportTitle')}</DialogTitle>
          <DialogDescription>
            {t('moderation.reportDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>{t('moderation.reportReason')}</Label>
            <RadioGroup value={reason} onValueChange={setReason} className="mt-2">
              {reasons.map((r) => (
                <div key={r.value} className="flex items-center space-x-2">
                  <RadioGroupItem value={r.value} id={r.value} />
                  <Label htmlFor={r.value} className="font-normal cursor-pointer">
                    {r.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div>
            <Label htmlFor="description">{t('moderation.reportDescription2')}</Label>
            <Textarea
              id="description"
              placeholder={t('moderation.reportDescriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-2"
              rows={3}
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? t('moderation.reportSubmitting') : t('moderation.reportSubmit')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReportContentDialog;
