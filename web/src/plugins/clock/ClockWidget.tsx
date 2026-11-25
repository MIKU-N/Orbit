import { useEffect, useState } from 'react';
import { WidgetSurface } from '../../sdk/primitives';

interface ClockWidgetProps {
  showSeconds: boolean;
  cardless: boolean;
  managed: boolean;
  enableTilt: boolean;
  onToggleSeconds: () => void;
  layoutEditing: boolean;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function ClockWidget({
  showSeconds,
  cardless,
  managed,
  enableTilt,
  onToggleSeconds,
  layoutEditing,
}: ClockWidgetProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const timeStr = showSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
  const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 星期${WEEKDAYS[now.getDay()]}`;

  return (
    <WidgetSurface
      cardless={cardless}
      managed={managed}
      enableTilt={enableTilt}
      layoutEditing={layoutEditing}
      onClick={() => {
        if (!layoutEditing) onToggleSeconds();
      }}
      cardClassName="rounded-2xl px-6 py-4 cursor-pointer select-none text-center"
      plainClassName="py-1 cursor-pointer select-none text-center"
    >
      <div
        className={`text-6xl sm:text-7xl font-light tracking-tight tabular-nums ${
          cardless ? 'hero-shadow' : ''
        }`}
        style={{ color: cardless ? 'var(--hero-ink)' : 'var(--ink)' }}
      >
        {timeStr}
      </div>
      <div
        className={`text-xs sm:text-sm font-normal mt-1 ${cardless ? 'hero-shadow' : ''}`}
        style={{ color: cardless ? 'var(--hero-ink-muted)' : 'var(--ink-muted)' }}
      >
        {dateStr}
      </div>
    </WidgetSurface>
  );
}
