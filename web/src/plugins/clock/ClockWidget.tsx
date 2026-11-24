import { useEffect, useState } from 'react';

interface ClockWidgetProps {
  showSeconds: boolean;
  onToggleSeconds: () => void;
  layoutEditing: boolean;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function ClockWidget({ showSeconds, onToggleSeconds, layoutEditing }: ClockWidgetProps) {
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
    <div
      className="cursor-pointer py-1 select-none"
      onClick={() => {
        if (!layoutEditing) onToggleSeconds();
      }}
    >
      <div className="text-6xl sm:text-7xl font-light tracking-tight tabular-nums hero-shadow text-white">
        {timeStr}
      </div>
      <div className="text-xs sm:text-sm font-normal hero-shadow text-white/80 mt-1">{dateStr}</div>
    </div>
  );
}
