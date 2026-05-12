import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useRecentPartners } from "@/hooks/usePartners";
import OptimizedAvatar from "@/components/shared/OptimizedAvatar";

interface RecentPartnersProps {
  userId: string;
}

const RecentPartners = ({ userId }: RecentPartnersProps) => {
  const navigate = useNavigate();
  const { data: partners = [], isLoading: loading } = useRecentPartners(userId);

  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2 px-4 scrollbar-hide">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="min-w-[90px]">
            <div className="bg-white/20 rounded-2xl p-3 backdrop-blur-sm">
              <div className="w-12 h-12 rounded-xl bg-white/30 animate-pulse mx-auto" />
              <div className="w-14 h-2 bg-white/30 rounded-full animate-pulse mx-auto mt-2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (partners.length === 0) {
    return null;
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 px-4 scrollbar-hide">
      {partners.map((partner, index) => (
        <motion.button
          key={partner.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
          onClick={() => navigate(`/partner/${partner.id}`)}
          className="min-w-[90px]"
        >
          <div className="bg-white/15 backdrop-blur-sm rounded-2xl p-3 hover:bg-white/25 transition-all duration-200 active:scale-95">
            {/* Avatar quadrato con angoli arrotondati */}
            <div className="w-14 h-14 mx-auto rounded-xl overflow-hidden shadow-lg ring-2 ring-white/30">
              <OptimizedAvatar
                src={partner.profile_image_url}
                fallback={(partner.business_name || "P")[0]}
                size="medium"
                className="w-full h-full rounded-xl"
              />
            </div>
            {/* Nome */}
            <p className="text-[11px] text-white font-semibold truncate text-center mt-2 drop-shadow-sm">
              {(partner.business_name || "Partner").split(" ")[0]}
            </p>
          </div>
        </motion.button>
      ))}
    </div>
  );
};

export default RecentPartners;
