import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, CheckCircle } from "lucide-react";

const UpdatePassword = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const checkSessionAndTokens = async () => {
      // Try to get session directly from Supabase (it might have processed tokens already)
      let { data: { session } } = await supabase.auth.getSession();

      // If no session, try to extract tokens from various sources
      if (!session) {
        let accessToken: string | null = null;
        let refreshToken: string | null = null;

        // Source 1: Check sessionStorage (saved by main.tsx before HashRouter loads)
        accessToken = sessionStorage.getItem('recovery_access_token');
        refreshToken = sessionStorage.getItem('recovery_refresh_token');

        // Clean up sessionStorage after reading
        if (accessToken) {
          sessionStorage.removeItem('recovery_access_token');
          sessionStorage.removeItem('recovery_refresh_token');
          console.log('🔑 Found recovery tokens in sessionStorage');
        }

        // Source 2: Check URL hash (HashRouter format)
        if (!accessToken) {
          const hashContent = window.location.hash;
          if (hashContent.includes('access_token')) {
            const queryPart = hashContent.split('?')[1];
            if (queryPart) {
              const params = new URLSearchParams(queryPart);
              accessToken = params.get('access_token');
              refreshToken = params.get('refresh_token');
            }
          }
        }

        // Source 3: Check query params
        if (!accessToken) {
          const searchParams = window.location.search;
          if (searchParams) {
            const params = new URLSearchParams(searchParams);
            accessToken = params.get('access_token');
            refreshToken = params.get('refresh_token');
          }
        }

        if (accessToken) {
          // Explicitly set session if tokens are found
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || ''
          });

          if (error) {
            console.error("Error setting session:", error);
            toast({
              title: "Error de sesión",
              description: "El enlace ha expirado o es inválido. Solicita uno nuevo.",
              variant: "destructive",
            });
            navigate("/reset-password");
            return;
          }
          // After setting session, re-fetch it to ensure it's active
          ({ data: { session } } = await supabase.auth.getSession());
        } else {
          console.log("No session or tokens found, redirecting to reset-password.");
          navigate("/reset-password");
          return;
        }
      }

      if (!session) {
        console.log("Still no session after token processing, redirecting to reset-password.");
        navigate("/reset-password");
      }
    };
    checkSessionAndTokens();
  }, [navigate, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        title: "Error",
        description: "Las contraseñas no coinciden",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: "Error",
        description: "La contraseña debe tener al menos 6 caracteres",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) throw error;

      setSuccess(true);
      toast({
        title: "¡Contraseña actualizada!",
        description: "Tu contraseña ha sido cambiada exitosamente",
      });

      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate("/login");
      }, 3000);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "No se pudo actualizar la contraseña",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary flex items-center justify-center p-4">
        <div className="w-full max-w-md ios-card p-6 space-y-6 text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
          <h1 className="text-2xl font-bold text-foreground">¡Contraseña Actualizada!</h1>
          <p className="text-muted-foreground">
            Tu contraseña ha sido cambiada exitosamente. Serás redirigido al login...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary flex items-center justify-center p-4">
      <div className="w-full max-w-md ios-card p-6 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-primary">Students Life</h1>
          <p className="text-muted-foreground mt-2">Establece tu nueva contraseña</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Nueva contraseña</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                className="ios-input pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                required
                className="ios-input pr-10"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repite la contraseña"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full ios-button h-12"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Actualizando...
              </>
            ) : (
              "Actualizar contraseña"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default UpdatePassword;
