interface NotificationBadgeProps {
  count: number;
  className?: string;
}

const NotificationBadge = ({ count, className = "" }: NotificationBadgeProps) => {
  if (count === 0) return null;

  return (
    <div
      className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center px-1 ${className}`}
    >
      {count > 99 ? "99+" : count}
    </div>
  );
};

export default NotificationBadge;
