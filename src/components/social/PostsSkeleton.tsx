const PostSkeleton = () => (
  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-3 max-w-[470px] mx-auto animate-pulse">
    {/* Header */}
    <div className="p-3 flex items-center gap-3">
      <div className="h-9 w-9 rounded-full bg-gray-200" />
      <div className="flex-1">
        <div className="h-4 w-24 bg-gray-200 rounded mb-1" />
        <div className="h-3 w-16 bg-gray-100 rounded" />
      </div>
    </div>

    {/* Content placeholder */}
    <div className="px-3 pb-2">
      <div className="h-3 w-full bg-gray-100 rounded mb-1" />
      <div className="h-3 w-3/4 bg-gray-100 rounded" />
    </div>

    {/* Media placeholder */}
    <div className="relative bg-gradient-to-br from-gray-100 via-gray-50 to-gray-100 h-64 overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative">
          <div className="w-12 h-12 border-3 border-gray-200 rounded-full" />
          <div className="absolute inset-0 w-12 h-12 border-3 border-transparent border-t-blue-300 rounded-full animate-spin" />
        </div>
      </div>
      {/* Shimmer effect */}
      <div
        className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent"
        style={{
          animation: "shimmer 2s infinite",
        }}
      />
    </div>

    {/* Actions placeholder */}
    <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="w-6 h-6 bg-gray-200 rounded" />
        <div className="w-6 h-6 bg-gray-200 rounded" />
        <div className="w-6 h-6 bg-gray-200 rounded" />
      </div>
      <div className="w-6 h-6 bg-gray-200 rounded" />
    </div>

    <style>{`
      @keyframes shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(200%); }
      }
    `}</style>
  </div>
);

interface PostsSkeletonProps {
  count?: number;
}

const PostsSkeleton = ({ count = 3 }: PostsSkeletonProps) => {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <PostSkeleton key={i} />
      ))}
    </div>
  );
};

export default PostsSkeleton;
