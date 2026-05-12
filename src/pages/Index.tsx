import { useEffect } from "react";

/**
 * La landing pubblica di Pasify è il sito statico completo in
 * /public/landing/ (HTML/CSS/JS originale, copiato da pasify-main).
 * La carichiamo via iframe a piena pagina così otteniamo fedeltà 100%
 * con il design originale; i link "Entrar" e "Crear cuenta" usano
 * target="_top" per rompere fuori dall'iframe e portare alle rotte React.
 */
const Index = () => {
  useEffect(() => {
    document.title = "Pasify — El sistema operativo de los eventos";
  }, []);

  return (
    <iframe
      src="/landing/pasify.html"
      title="Pasify"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        border: 0,
        margin: 0,
        padding: 0,
      }}
    />
  );
};

export default Index;
