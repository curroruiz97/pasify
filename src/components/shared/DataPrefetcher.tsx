/**
 * Pasify: DataPrefetcher disabilitato.
 * Lo pasify prefettava categories/posts/discounts/reviews/gallery/partners
 * che in Pasify non esistono. Manteniamo il componente come no-op per non
 * rompere l'import in App.tsx; ripristinare con query Pasify-specific se serve.
 */
interface DataPrefetcherProps {
  userId?: string;
}

const DataPrefetcher = (_props: DataPrefetcherProps) => null;

export default DataPrefetcher;
