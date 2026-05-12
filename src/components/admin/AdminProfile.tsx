import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Camera, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { compressAvatar } from "@/lib/imageUtils";

const AdminProfile = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) return;

      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      setProfile(profileData);
    } catch (error: any) {
      toast({
        title: "Errore",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "Errore",
        description: "L'immagine deve essere inferiore a 5MB",
        variant: "destructive",
      });
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Errore",
        description: "Il file deve essere un'immagine",
        variant: "destructive",
      });
      return;
    }

    try {
      setUploading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Comprimi avatar
      const compressedFile = await compressAvatar(file);
      const fileName = `${user.id}-${Date.now()}.jpg`;
      const filePath = `${user.id}/${fileName}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, compressedFile, { upsert: true, cacheControl: '31536000' });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // Update profile
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ profile_image_url: publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      toast({
        title: "Successo",
        description: "Foto profilo aggiornata",
      });

      await loadProfile();
    } catch (error: any) {
      toast({
        title: "Errore",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="ios-card p-8">
        <h2 className="text-2xl font-bold text-primary mb-6">Profilo Amministratore</h2>
        
        <div className="flex flex-col items-center mb-8">
          <div className="relative">
            <Avatar className="w-32 h-32 border-4 border-primary shadow-lg">
              <AvatarImage src={profile?.profile_image_url || ""} />
              <AvatarFallback className="bg-gradient-to-br from-primary to-secondary text-white text-3xl">
                <User className="w-16 h-16" />
              </AvatarFallback>
            </Avatar>
            
            <label htmlFor="avatar-upload" className="absolute bottom-0 right-0">
              <Button
                size="icon"
                className="rounded-full w-10 h-10 shadow-lg bg-gradient-to-br from-primary to-secondary"
                disabled={uploading}
                asChild
              >
                <span>
                  <Camera className="w-5 h-5" />
                </span>
              </Button>
              <input
                id="avatar-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
                disabled={uploading}
              />
            </label>
          </div>
          
          {uploading && (
            <p className="text-sm text-muted-foreground mt-4">Caricamento...</p>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-gradient-to-br from-primary/5 to-secondary/5 rounded-xl p-4">
            <p className="text-sm text-muted-foreground mb-1">Nome</p>
            <p className="text-lg font-semibold text-foreground">
              {profile?.first_name || "Admin"} {profile?.last_name || ""}
            </p>
          </div>

          <div className="bg-gradient-to-br from-primary/5 to-secondary/5 rounded-xl p-4">
            <p className="text-sm text-muted-foreground mb-1">Email</p>
            <p className="text-lg font-semibold text-foreground">
              {profile?.email || "admin@studentslife.com"}
            </p>
          </div>

          <div className="bg-gradient-to-br from-primary/5 to-secondary/5 rounded-xl p-4">
            <p className="text-sm text-muted-foreground mb-1">Ruolo</p>
            <p className="text-lg font-semibold text-primary">
              Amministratore
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminProfile;
