import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Ban } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface BlockUserButtonProps {
  userId: string;
  userName: string;
  trigger?: React.ReactNode;
  onBlocked?: () => void;
}

const BlockUserButton = ({
  userId,
  userName,
  trigger,
  onBlocked,
}: BlockUserButtonProps) => {
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  const handleBlock = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const { error } = await supabase.from("user_blocks").insert({
        blocker_user_id: user.id,
        blocked_user_id: userId,
      });

      if (error) throw error;

      toast.success(t('moderation.userBlocked', { userName }));
      onBlocked?.();
    } catch (error: any) {
      console.error("Error blocking user:", error);
      if (error.code === "23505") {
        toast.error(t('moderation.alreadyBlocked'));
      } else {
        toast.error(t('moderation.errorBlocking'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm">
            <Ban className="w-4 h-4 mr-2" />
            {t('moderation.blockUser')}
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('moderation.blockUserTitle', { userName })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('moderation.blockUserMessage')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={handleBlock} disabled={loading}>
            {loading ? t('moderation.blocking') : t('moderation.blockUser')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default BlockUserButton;
