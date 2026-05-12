import React from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Autoplay, Navigation, Pagination } from 'swiper/modules';

import 'swiper/css';
import 'swiper/css/pagination';
import 'swiper/css/navigation';

interface CardCarouselProps {
  slides: React.ReactNode[];
  autoplayDelay?: number;
  showPagination?: boolean;
  showNavigation?: boolean;
  slidesPerViewDesktop?: number;
}

export const CardCarousel: React.FC<CardCarouselProps> = ({
  slides,
  autoplayDelay = 4000,
  showPagination = true,
  showNavigation = false,
  slidesPerViewDesktop = 3,
}) => {
  const css = `
    .card-carousel .swiper { width: 100%; padding-bottom: 50px; }
    .card-carousel .swiper-wrapper { align-items: stretch; }
    .card-carousel .swiper-slide { height: auto; display: flex; }
    .card-carousel .swiper-slide > * { width: 100%; }
    .card-carousel .swiper-pagination-bullet { background: rgba(15, 23, 42, 0.3); opacity: 1; }
    .card-carousel .swiper-pagination-bullet-active { background: #0ea5e9; width: 28px; border-radius: 999px; }
  `;

  return (
    <div className="card-carousel w-full">
      <style>{css}</style>
      <Swiper
        spaceBetween={24}
        autoplay={autoplayDelay ? { delay: autoplayDelay, disableOnInteraction: false } : false}
        grabCursor
        centeredSlides={false}
        loop={slides.length > slidesPerViewDesktop}
        slidesPerView={1}
        breakpoints={{
          640: { slidesPerView: 2, spaceBetween: 24 },
          900: { slidesPerView: slidesPerViewDesktop, spaceBetween: 24 },
        }}
        pagination={showPagination ? { clickable: true } : false}
        navigation={showNavigation}
        modules={[Autoplay, Pagination, Navigation]}
      >
        {slides.map((node, i) => (
          <SwiperSlide key={i}>{node}</SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
};
