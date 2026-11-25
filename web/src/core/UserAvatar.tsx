import { useEffect, useState } from 'react';
import type { User } from '../types';

interface UserAvatarProps {
  user?: Pick<User, 'username' | 'avatar'> | null;
  sizeClass?: string;
  textClass?: string;
  className?: string;
}

export function UserAvatar({
  user,
  sizeClass = 'w-8 h-8',
  textClass = 'text-xs',
  className = '',
}: UserAvatarProps) {
  const [failed, setFailed] = useState(false);
  const avatarUrl = (user?.avatar || '').trim();

  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  if (avatarUrl && !failed) {
    return (
      <span
        className={`${sizeClass} rounded-full overflow-hidden block shrink-0 bg-black/20 ${className}`}
      >
        <img
          src={avatarUrl}
          alt={user?.username || 'avatar'}
          onError={() => setFailed(true)}
          className="block w-full h-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      className={`${sizeClass} rounded-full flex items-center justify-center text-white font-semibold shrink-0 ${textClass} ${className}`}
      style={{ background: 'var(--brand-solid)' }}
    >
      {(user?.username?.[0] || 'O').toUpperCase()}
    </span>
  );
}
