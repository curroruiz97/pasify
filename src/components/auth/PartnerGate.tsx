/**
 * Pasify: PartnerGate disabilitato.
 *
 * Lo studentslife usava questo gate per richiedere una subscription Stripe
 * attiva PRIMA di mostrare la /partner-dashboard, redirigendo altrimenti a
 * /partner/choose-plan o /partner/subscribe. In Pasify per ora il locale entra
 * subito (Stripe Connect lo collega dalla sezione "Stripe" della sua dashboard)
 * e il flow subscription verrà riattivato dopo.
 *
 * Manteniamo l'export per non rompere le import in App.tsx; semplicemente
 * facciamo passare i children.
 */
export const PartnerGate = ({ children }: { children: React.ReactNode }) => {
  return <>{children}</>;
};

export default PartnerGate;
