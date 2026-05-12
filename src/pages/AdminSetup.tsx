import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

// Temporary utility page to promote a user to admin via backend function
// Safe to remove after setup
const AdminSetup = () => {
  const [email, setEmail] = useState("admin@gmail.com");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Setup Admin | Students Life";
  }, []);

  const handleSetAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.rpc("set_admin_by_email", { _email: email });
      if (error) throw error;

      toast({
        title: "Admin assegnato",
        description: `L'utente ${email} è ora amministratore.`,
      });
      navigate("/login");
    } catch (err: any) {
      toast({
        title: "Errore",
        description:
          err?.message ||
          "Impossibile assegnare il ruolo. Assicurati che l'utente esista (registralo prima).",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-secondary/5 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Setup Amministratore</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSetAdmin} className="space-y-4">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="ios-input"
              placeholder="Email utente"
              aria-label="Email utente"
            />
            <Button type="submit" disabled={loading} className="w-full ios-button">
              {loading ? "Imposto..." : "Rendi Admin"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminSetup;
