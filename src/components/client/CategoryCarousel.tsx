import { useState } from "react";
import { Folder, Utensils, ShoppingBag, Scissors, Sparkles, Music, Dumbbell, GraduationCap, PartyPopper, Coffee, Beer, Pizza, Heart, Cake, Camera, Shirt, Plane, Tv, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { useCategories } from "@/hooks/usePartners";

interface CategoryCarouselProps {
  onSelectCategory: (category: string) => void;
}

// Icon mapping for categories
const categoryIcons: { [key: string]: React.ComponentType<any> } = {
  restaurante: Utensils,
  tienda: ShoppingBag,
  peluqueria: Scissors,
  belleza: Sparkles,
  discoteca: Music,
  gimnasio: Dumbbell,
  academia: GraduationCap,
  eventos: PartyPopper,
  cafeteria: Coffee,
  bar: Beer,
  pizzeria: Pizza,
  moda: Shirt,
  fotografia: Camera,
  pasteleria: Cake,
  favoritos: Heart,
  viajes: Plane,
  entretenimiento: Tv,
  electronica: Zap,
  shopping: ShoppingBag,
};

const CategoryCarousel = ({ onSelectCategory }: CategoryCarouselProps) => {
  const [selected, setSelected] = useState<string | null>(null);
  const { data: categories = [], isLoading: loading } = useCategories();

  const handleSelect = (value: string) => {
    const newSelected = selected === value ? null : value;
    setSelected(newSelected);
    onSelectCategory(newSelected || "");
  };

  const getCategoryIcon = (name: string) => {
    const normalizedName = name.toLowerCase().replace(/\s+/g, "");
    return categoryIcons[normalizedName] || Folder;
  };

  // Build rows in 2-3-2-3 pattern, never leaving 1 alone
  const getLayout = () => {
    const items = [...categories];
    const rows: typeof categories[] = [];
    let useTwo = true;
    while (items.length > 0) {
      const take = useTwo ? 2 : 3;
      if (items.length <= 3 && items.length > 0) {
        // Last chunk: if 1 left, merge with previous row or take all
        if (items.length === 1 && rows.length > 0) {
          rows[rows.length - 1].push(...items.splice(0));
        } else {
          rows.push(items.splice(0));
        }
      } else {
        rows.push(items.splice(0, take));
        useTwo = !useTwo;
      }
    }
    return rows;
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex justify-center gap-3">
          {[1, 2].map((i) => (
            <div key={i} className="flex-1 bg-white/20 rounded-2xl h-28 animate-pulse" />
          ))}
        </div>
        <div className="flex justify-center gap-3">
          {[3, 4, 5].map((i) => (
            <div key={i} className="flex-1 bg-white/20 rounded-2xl h-28 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const rows = getLayout();
  let itemIndex = 0;

  return (
    <div className="space-y-3">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex justify-center gap-3">
          {row.map((category) => {
            const currentIndex = itemIndex++;
            const isSelected = selected === category.name;
            const IconComponent = getCategoryIcon(category.name);

            return (
              <motion.button
                key={category.id}
                onClick={() => handleSelect(category.name)}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  delay: currentIndex * 0.04,
                  type: "spring",
                  stiffness: 300,
                  damping: 25
                }}
                whileTap={{ scale: 0.95 }}
                className={`
                  relative rounded-2xl overflow-hidden shadow-md
                  w-[105px] h-[110px]
                  transition-all duration-200
                  ${isSelected ? "ring-2 ring-white shadow-lg shadow-cyan-500/30" : ""}
                `}
              >
                {/* Image area */}
                <div className="w-full h-full overflow-hidden">
                  {category.image_url ? (
                    <>
                      <img
                        src={category.image_url}
                        alt={category.display_name}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-cyan-600/80 via-cyan-500/20 to-transparent" />
                    </>
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                      <IconComponent className="w-9 h-9 text-white/80" />
                    </div>
                  )}
                </div>

                {/* Category name - overlay at bottom */}
                <div className="absolute bottom-0 left-0 right-0 px-2 py-2">
                  <span className="font-bold text-xs text-white drop-shadow-md leading-tight line-clamp-1">
                    {category.display_name}
                  </span>
                </div>

                {/* Selection indicator */}
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute top-1.5 right-1.5 w-5 h-5 bg-white rounded-full shadow-lg flex items-center justify-center"
                  >
                    <svg className="w-3 h-3 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </motion.div>
                )}
              </motion.button>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export default CategoryCarousel;
