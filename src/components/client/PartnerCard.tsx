import { useNavigate } from "react-router-dom";
import { Star, MapPin, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import { getThumbnail, getCardImage } from "@/lib/imageUtils";

interface PartnerCardProps {
  partner: {
    id: string;
    business_name?: string;
    business_address?: string;
    business_city?: string;
    profile_image_url?: string;
    gallery?: Array<{ image_url: string }>;
    reviews?: Array<{ rating: number }>;
  };
  compact?: boolean;
  listMode?: boolean;
}

const PartnerCard = ({ partner, compact = false, listMode = false }: PartnerCardProps) => {
  const navigate = useNavigate();

  // Calculate average rating
  const avgRating = partner.reviews && partner.reviews.length > 0
    ? partner.reviews.reduce((sum, r) => sum + r.rating, 0) / partner.reviews.length
    : 0;

  // Get display image - prefer gallery first image, fallback to profile
  const displayImage = partner.gallery?.[0]?.image_url || partner.profile_image_url;

  if (compact) {
    return (
      <motion.div
        onClick={() => navigate(`/partner/${partner.id}`)}
        whileHover={{ scale: 1.02, y: -2 }}
        whileTap={{ scale: 0.98 }}
        className="bg-white rounded-[24px] overflow-hidden cursor-pointer min-w-[140px] shadow-lg hover:shadow-xl transition-shadow duration-300"
      >
        {/* Circular Image */}
        <div className="p-3 pb-2">
          <div className="relative w-20 h-20 mx-auto">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-full opacity-20 blur-md" />
            {displayImage ? (
              <img
                src={getThumbnail(displayImage)}
                alt={partner.business_name}
                loading="lazy"
                className="w-full h-full object-cover rounded-full ring-4 ring-white shadow-lg relative z-10"
              />
            ) : (
              <div className="w-full h-full rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center ring-4 ring-white shadow-lg relative z-10">
                <span className="text-2xl font-bold text-white">
                  {partner.business_name?.[0] || "?"}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Name */}
        <div className="px-3 pb-3 text-center">
          <h3 className="font-bold text-sm text-gray-800 truncate">
            {partner.business_name || "Partner"}
          </h3>
          {avgRating > 0 && (
            <div className="flex items-center justify-center gap-1 mt-1">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              <span className="text-xs font-semibold text-gray-600">{avgRating.toFixed(1)}</span>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  // List mode - horizontal card for vertical list
  if (listMode) {
    return (
      <motion.div
        onClick={() => navigate(`/partner/${partner.id}`)}
        whileTap={{ scale: 0.98 }}
        className="bg-white rounded-2xl overflow-hidden cursor-pointer shadow-md hover:shadow-lg active:shadow-md transition-all duration-200 flex h-28"
      >
        {/* Image */}
        <div className="relative w-28 h-full flex-shrink-0 overflow-hidden">
          {displayImage ? (
            <img
              src={getCardImage(displayImage)}
              alt={partner.business_name}
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-cyan-400 to-blue-500">
              <span className="text-3xl font-bold text-white/80">
                {partner.business_name?.[0] || "?"}
              </span>
            </div>
          )}
          {/* Rating badge */}
          {avgRating > 0 && (
            <div className="absolute top-2 left-2 bg-white/95 backdrop-blur-sm rounded-full px-1.5 py-0.5 flex items-center gap-0.5 shadow">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              <span className="text-[10px] font-bold text-gray-800">{avgRating.toFixed(1)}</span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 p-3 flex flex-col justify-center min-w-0">
          <h3 className="font-bold text-base text-gray-900 truncate">
            {partner.business_name || "Partner"}
          </h3>

          {partner.business_address && (
            <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
              <MapPin className="w-3 h-3 flex-shrink-0 text-cyan-500" />
              <p className="truncate">
                {partner.business_address}
                {partner.business_city && `, ${partner.business_city}`}
              </p>
            </div>
          )}

          {/* Stars row */}
          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`w-3 h-3 ${
                    star <= avgRating
                      ? "fill-amber-400 text-amber-400"
                      : "text-gray-200"
                  }`}
                />
              ))}
            </div>
            {partner.reviews && partner.reviews.length > 0 && (
              <span className="text-[10px] text-gray-400 font-medium">
                ({partner.reviews.length})
              </span>
            )}
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-center pr-3 flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow">
            <ChevronRight className="w-4 h-4 text-white" />
          </div>
        </div>
      </motion.div>
    );
  }

  // Default - full card (used elsewhere)
  return (
    <motion.div
      onClick={() => navigate(`/partner/${partner.id}`)}
      whileHover={{ scale: 1.02, y: -4 }}
      whileTap={{ scale: 0.98 }}
      className="bg-white rounded-[28px] overflow-hidden cursor-pointer min-w-[280px] shadow-xl hover:shadow-2xl transition-all duration-300"
    >
      {/* Image with gradient overlay */}
      <div className="relative h-44 overflow-hidden">
        {displayImage ? (
          <>
            <img
              src={getCardImage(displayImage)}
              alt={partner.business_name}
              loading="lazy"
              className="w-full h-full object-cover"
            />
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-cyan-400 to-blue-500">
            <span className="text-5xl font-bold text-white/80">
              {partner.business_name?.[0] || "?"}
            </span>
          </div>
        )}

        {/* Rating badge on image */}
        {avgRating > 0 && (
          <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-sm rounded-full px-2.5 py-1 flex items-center gap-1 shadow-lg">
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span className="text-xs font-bold text-gray-800">{avgRating.toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-lg text-gray-900 truncate">
              {partner.business_name || "Partner"}
            </h3>

            {/* Address */}
            {partner.business_address && (
              <div className="flex items-center gap-1.5 mt-1 text-sm text-gray-500">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-cyan-500" />
                <p className="truncate">
                  {partner.business_address}
                  {partner.business_city && `, ${partner.business_city}`}
                </p>
              </div>
            )}
          </div>

          {/* Arrow button */}
          <div className="ml-3 w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg flex-shrink-0">
            <ChevronRight className="w-5 h-5 text-white" />
          </div>
        </div>

        {/* Bottom info */}
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`w-3.5 h-3.5 ${
                  star <= avgRating
                    ? "fill-amber-400 text-amber-400"
                    : "text-gray-200"
                }`}
              />
            ))}
          </div>
          {partner.reviews && partner.reviews.length > 0 && (
            <span className="text-xs text-gray-400 font-medium">
              {partner.reviews.length} reseñas
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default PartnerCard;
