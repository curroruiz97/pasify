import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import UploadSheet from "@/components/shared/UploadSheet"; // Import the existing UploadSheet component
interface CreateStoryDialogProps {
open: boolean;
onOpenChange: (open: boolean) => void;
userId: string;
onStoryCreated: () => void;
}
const CreateStoryDialog = ({ open, onOpenChange, userId, onStoryCreated }: CreateStoryDialogProps) => {
// This component will now simply act as a wrapper to open the UploadSheet for story creation.
// The logic for handling media upload and publishing will be managed by UploadSheet.
const handleUploadComplete = () => {
// When UploadSheet completes an upload, trigger the onStoryCreated callback
onStoryCreated();
onOpenChange(false); // Close the sheet after upload
};
  return (
    <UploadSheet
      open={open}
      onOpenChange={onOpenChange}
      userId={userId}
      onUploadComplete={handleUploadComplete}
      uploadType="story"
    />
  );
};
export default CreateStoryDialog;