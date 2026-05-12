import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Upload, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Category {
  id: string;
  name: string;
  display_name: string;
  image_url: string | null;
}

const CategoriesManagement = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [newCategory, setNewCategory] = useState({ name: "", display_name: "" });
  const [uploadingImage, setUploadingImage] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("display_name");

      if (error) throw error;
      setCategories(data || []);
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

  const handleAddCategory = async () => {
    if (!newCategory.name || !newCategory.display_name) {
      toast({
        title: "Errore",
        description: "Compila tutti i campi",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase.from("categories").insert({
        name: newCategory.name.toLowerCase().replace(/\s+/g, "_"),
        display_name: newCategory.display_name,
      });

      if (error) throw error;

      toast({
        title: "Successo",
        description: "Categoria aggiunta",
      });

      setShowDialog(false);
      setNewCategory({ name: "", display_name: "" });
      fetchCategories();
    } catch (error: any) {
      toast({
        title: "Errore",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleUploadImage = async (categoryId: string, file: File) => {
    setUploadingImage(categoryId);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${categoryId}.${fileExt}`;
      const filePath = `categories/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("gallery")
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("gallery")
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from("categories")
        .update({ image_url: publicUrl })
        .eq("id", categoryId);

      if (updateError) throw updateError;

      toast({
        title: "Successo",
        description: "Immagine caricata",
      });

      fetchCategories();
    } catch (error: any) {
      toast({
        title: "Errore",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploadingImage(null);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Sei sicuro di voler eliminare questa categoria?")) return;

    try {
      const { error } = await supabase.from("categories").delete().eq("id", id);

      if (error) throw error;

      toast({
        title: "Successo",
        description: "Categoria eliminata",
      });

      fetchCategories();
    } catch (error: any) {
      toast({
        title: "Errore",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return <div>Caricamento...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Gestione Categorie</h2>
        <Button onClick={() => setShowDialog(true)} className="ios-button">
          <Plus className="w-4 h-4 mr-2" />
          Nuova Categoria
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((category) => (
          <Card key={category.id}>
            <CardHeader>
              <CardTitle className="text-lg">{category.display_name}</CardTitle>
              <p className="text-sm text-muted-foreground">{category.name}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {category.image_url ? (
                <img
                  src={category.image_url}
                  alt={category.display_name}
                  className="w-full h-40 object-cover rounded-lg"
                />
              ) : (
                <div className="w-full h-40 bg-muted rounded-lg flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">Nessuna immagine</p>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={uploadingImage === category.id}
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/*";
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) handleUploadImage(category.id, file);
                    };
                    input.click();
                  }}
                >
                  <Upload className="w-4 h-4 mr-1" />
                  {uploadingImage === category.id ? "Caricamento..." : "Carica"}
                </Button>

                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleDeleteCategory(category.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuova Categoria</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Nome tecnico (es: bar_restaurant)</label>
              <Input
                value={newCategory.name}
                onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                placeholder="bar_restaurant"
                className="ios-input"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Nome visualizzato</label>
              <Input
                value={newCategory.display_name}
                onChange={(e) => setNewCategory({ ...newCategory, display_name: e.target.value })}
                placeholder="Bar & Ristoranti"
                className="ios-input"
              />
            </div>
            <Button onClick={handleAddCategory} className="w-full ios-button">
              Aggiungi Categoria
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CategoriesManagement;
