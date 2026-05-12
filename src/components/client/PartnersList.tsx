import PartnerCard from "./PartnerCard";
import { motion, AnimatePresence } from "framer-motion";
import { Store } from "lucide-react";
import { usePartnersByCategory } from "@/hooks/usePartners";

interface PartnersListProps {
  category: string;
  city?: string | null;
  country?: string | null;
}

const PartnersList = ({ category, city, country }: PartnersListProps) => {
  // Usa hook cached per i partner per categoria, città e paese
  const { data: partners = [], isLoading: loading } = usePartnersByCategory(category, city, country);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="bg-white rounded-2xl overflow-hidden shadow-md flex h-28"
          >
            <div className="w-28 h-full bg-gradient-to-br from-cyan-100 to-blue-100 animate-pulse flex-shrink-0" />
            <div className="flex-1 p-3 space-y-2.5 flex flex-col justify-center">
              <div className="h-4 bg-gray-100 rounded-full w-3/4 animate-pulse" />
              <div className="h-3 bg-gray-100 rounded-full w-full animate-pulse" />
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <div key={s} className="w-3 h-3 bg-gray-100 rounded-full animate-pulse" />
                ))}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    );
  }

  if (partners.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-[28px] p-8 text-center shadow-xl"
      >
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center">
          <Store className="w-8 h-8 text-cyan-500" />
        </div>
        <p className="text-gray-500 font-medium">
          No hay socios en esta categoría
        </p>
        <p className="text-gray-400 text-sm mt-1">
          ¡Pronto habrá más opciones!
        </p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-3">
      <AnimatePresence mode="popLayout">
        {partners.map((partner, index) => (
          <motion.div
            key={partner.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ delay: index * 0.06, type: "spring", stiffness: 300, damping: 25 }}
          >
            <PartnerCard partner={partner} listMode />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

export default PartnersList;
