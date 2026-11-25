import React from 'react';

interface MotionCardProps extends React.HTMLAttributes<HTMLDivElement> {
  enableTilt: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}

export function MotionCard({
  enableTilt,
  disabled,
  className = '',
  children,
  onMouseMove,
  onMouseLeave,
  ...rest
}: MotionCardProps) {
  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const animationsOff =
      typeof document !== 'undefined' &&
      document.documentElement.dataset.orbitAnimations === 'off';
    const card = e.currentTarget;
    if (animationsOff) {
      if (card.style.transform) card.style.transform = '';
      onMouseMove?.(e);
      return;
    }
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    card.style.setProperty('--my', `${e.clientY - rect.top}px`);
    if (enableTilt && !disabled) {
      const rx = ((e.clientY - rect.top) / rect.height - 0.5) * -5;
      const ry = ((e.clientX - rect.left) / rect.width - 0.5) * 5;
      card.style.transform = `perspective(700px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-2px)`;
    }
    onMouseMove?.(e);
  };

  const handleLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.transform = '';
    onMouseLeave?.(e);
  };

  return (
    <div
      className={`glass motion-card ${className}`}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      {...rest}
    >
      {children}
    </div>
  );
}
