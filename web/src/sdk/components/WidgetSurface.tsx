import type React from 'react';
import { MotionCard } from './MotionCard';

interface WidgetSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  cardless?: boolean;
  managed?: boolean;
  enableTilt?: boolean;
  layoutEditing?: boolean;
  cardClassName?: string;
  plainClassName?: string;
  children: React.ReactNode;
}

/**
 * Unified managed widget frame shared by core and lightweight components.
 * Supports seamless toggling between frosted glass card mode and cardless plain mode.
 */
export function WidgetSurface({
  cardless = false,
  managed = true,
  enableTilt = true,
  layoutEditing = false,
  cardClassName = '',
  plainClassName = '',
  className = '',
  children,
  ...rest
}: WidgetSurfaceProps) {
  if (cardless) {
    return (
      <div
        data-widget-surface="plain"
        data-managed={managed ? 'true' : 'false'}
        className={`widget-plain relative transition-colors ${plainClassName} ${className}`}
        {...rest}
      >
        {children}
      </div>
    );
  }

  return (
    <MotionCard
      data-widget-surface="card"
      data-managed={managed ? 'true' : 'false'}
      enableTilt={enableTilt}
      disabled={layoutEditing}
      className={`${cardClassName} ${className}`}
      {...rest}
    >
      {children}
    </MotionCard>
  );
}
