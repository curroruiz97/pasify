/**
 * useMediaCleanup · LEGACY NEUTRALIZED stub.
 *
 * En Pasify borraba archivos huérfanos de los buckets `posts`, `stories`,
 * `qr_codes`, `discounts` cuando se eliminaba la fila relacionada. Esas tablas
 * y buckets no existen ya en Pasify. Mantenemos la firma para los consumers
 * (PartnerEventsManager, PartnerGalleryManager, PostCard orphan) y todas las
 * funciones son no-op.
 *
 * Si Pasify reintroduce galerías propias (bucket `partner-galleries` ya creado
 * según el plan), este es el sitio para cablear la limpieza real.
 */

export const useMediaCleanup = () => {
  const noop = async () => {};
  return {
    cleanupOrphanedFiles: noop,
    deleteFile: noop,
    deletePostMedia: noop,
    deleteEventMedia: noop,
    deleteDiscountMedia: noop,
    deleteStoryMedia: noop,
    deleteEventByEventId: noop,
    deleteDiscountById: noop,
    deletePartnerAvatar: noop,
  };
};
