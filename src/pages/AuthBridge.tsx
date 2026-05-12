import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import LoaderOne from "@/components/ui/loader-one";

/**
 * Punto di atterraggio del link generato dall'app nativa via openWebWithAuth().
 * Legge access_token + refresh_token dal query string e crea la sessione
 * browser, poi reindirizza al path richiesto (es. /partner/manage).
 *
 * URL atteso:
 *   studentslife.app/#/auth/bridge?access=<at>&refresh=<rt>&next=/partner/manage
 */
const AuthBridge = () => {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        // HashRouter: i query params stanno dopo la '?' del path, non della URL.
        // Esempio: #/auth/bridge?access=x&refresh=y&next=/z
        // useSearchParams non funziona bene con hash router su questo layout.
        // Parso manualmente dall'hash.
        const hash = window.location.hash;
        const qIndex = hash.indexOf("?");
        if (qIndex === -1) {
          navigate("/login", { replace: true });
          return;
        }
        const params = new URLSearchParams(hash.substring(qIndex + 1));
        const access = params.get("access");
        const refresh = params.get("refresh");
        const next = params.get("next") || "/partner-dashboard";

        if (!access || !refresh) {
          navigate("/login", { replace: true });
          return;
        }

        const { error } = await supabase.auth.setSession({
          access_token: access,
          refresh_token: refresh,
        });

        // Pulisce URL per non lasciare i token nella history
        window.history.replaceState({}, "", window.location.pathname);

        if (error) {
          console.error("AuthBridge setSession error:", error);
          navigate("/login", { replace: true });
          return;
        }

        navigate(next, { replace: true });
      } catch (err) {
        console.error("AuthBridge error:", err);
        navigate("/login", { replace: true });
      }
    })();
  }, [navigate]);

  return <LoaderOne />;
};

export default AuthBridge;
