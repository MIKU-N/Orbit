import { useEffect, useState } from 'react';
import { Cloud, CloudLightning, CloudRain, Moon, Snowflake, Sun } from 'lucide-react';
import type { WeatherConfig, WeatherPayload } from '../../types';
import { MotionCard } from '../../sdk/primitives';

interface WeatherWidgetProps {
  weather: WeatherPayload | null;
  config: WeatherConfig;
  showSeconds?: boolean;
  enableTilt: boolean;
  layoutEditing: boolean;
  readOnly?: boolean;
  onOpenSettings: () => void;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function formatTempVal(c: number, unit: 'C' | 'F'): number {
  return unit === 'F' ? Math.round((c * 9) / 5 + 32) : Math.round(c);
}

export function WeatherWidget({
  weather,
  config,
  showSeconds = false,
  enableTilt,
  layoutEditing,
  readOnly = false,
  onOpenSettings,
}: WeatherWidgetProps) {
  const unit = config.unit || 'C';
  const style = config.style || 'standard';
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (style !== 'banner') return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [style]);

  const iconEl = (() => {
    switch (weather?.kind) {
      case 'clear':
        return weather.is_day === false ? (
          <Moon className="w-5 h-5 text-amber-200" />
        ) : (
          <Sun className="w-5 h-5 text-amber-300" />
        );
      case 'rain':
        return <CloudRain className="w-5 h-5 text-sky-300" />;
      case 'snow':
        return <Snowflake className="w-5 h-5 text-sky-200" />;
      case 'storm':
        return <CloudLightning className="w-5 h-5 text-amber-400" />;
      default:
        return <Cloud className="w-5 h-5 text-sky-200" />;
    }
  })();

  const cityDisplay = config.label?.trim() || weather?.city || config.query || '上海';

  const detailTags: string[] = [];
  if (weather) {
    if (config.showFeelsLike) {
      detailTags.push(`体感 ${formatTempVal(weather.feels_like_c ?? weather.temp_c, unit)}°`);
    }
    if (config.showHumidity) {
      detailTags.push(`湿度 ${weather.humidity}%`);
    }
    if (config.showHiLo) {
      detailTags.push(
        `${formatTempVal(weather.temp_min_c ?? weather.temp_c, unit)}~${formatTempVal(weather.temp_max_c ?? weather.temp_c, unit)}°`,
      );
    }
    if (config.showWind) {
      detailTags.push(`风 ${Math.round(weather.wind_kmh || 0)}km/h`);
    }
    if (config.showPrecip) {
      detailTags.push(`降水 ${weather.precip_prob ?? 0}%`);
    }
    if (config.showPressure) {
      detailTags.push(`${Math.round(weather.pressure_hpa || 1013)}hPa`);
    }
  }

  const forecastCount = config.forecastDays ?? 2;
  const slots =
    forecastCount > 0 && weather?.daily?.length
      ? weather.daily.slice(0, forecastCount).map((d) => ({
          label: d.label,
          temp: `${formatTempVal(d.temp_max_c, unit)}°`,
        }))
      : forecastCount > 0
        ? (weather?.slots || []).slice(0, forecastCount)
        : [];

  if (style === 'banner') {
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const timeStr = showSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
    const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 周${WEEKDAYS[now.getDay()]}`;
    const customCopy = config.customText?.trim() || `此刻 · ${cityDisplay}`;

    return (
      <MotionCard
        enableTilt={enableTilt}
        disabled={layoutEditing}
        onClick={() => {
          if (!layoutEditing && !readOnly) onOpenSettings();
        }}
        className={`rounded-2xl p-4 min-h-[108px] flex flex-col justify-between gap-2.5 ${
          readOnly ? 'cursor-default' : 'cursor-pointer'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm sm:text-[15px] font-medium leading-snug break-words line-clamp-2">
              {customCopy}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl sm:text-[26px] font-light tracking-tight tabular-nums leading-none">
              {timeStr}
            </div>
            <div className="text-[11px] mt-1 tabular-nums" style={{ color: 'var(--ink-muted)' }}>
              {dateStr}
            </div>
          </div>
        </div>

        <div
          className="flex items-center justify-between gap-2 pt-2 border-t text-xs"
          style={{ borderColor: 'var(--glass-border)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0 weather-float">{iconEl}</span>
            <span className="font-semibold text-sm tabular-nums shrink-0">
              {weather ? `${formatTempVal(weather.temp_c, unit)}°` : '--°'}
            </span>
            <span className="truncate" style={{ color: 'var(--ink-muted)' }}>
              {weather ? `${weather.cond} · ${cityDisplay}` : '加载中'}
            </span>
          </div>

          <div
            className="truncate text-right shrink-0 max-w-[46%]"
            style={{ color: 'var(--ink-muted)' }}
            title={detailTags.join(' · ')}
          >
            {detailTags.length > 0
              ? detailTags.slice(0, 2).join(' · ')
              : slots.length > 0
                ? slots.map((s) => `${s.label} ${s.temp}`).join(' · ')
                : ''}
          </div>
        </div>
      </MotionCard>
    );
  }

  return (
    <MotionCard
      enableTilt={enableTilt}
      disabled={layoutEditing}
      onClick={() => {
        if (!layoutEditing && !readOnly) onOpenSettings();
      }}
      className={`rounded-2xl p-4 min-h-[108px] flex flex-col justify-center ${
        readOnly ? 'cursor-default' : 'cursor-pointer'
      }`}
    >
      <div className="flex items-center justify-between gap-2.5 flex-nowrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center weather-float shrink-0"
            style={{ background: 'var(--pill-bg)' }}
          >
            {iconEl}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-2xl font-semibold tabular-nums shrink-0">
                {weather ? `${formatTempVal(weather.temp_c, unit)}°` : '--°'}
              </span>
              <span className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>
                {weather ? `${weather.cond} · ${cityDisplay}` : '加载中'}
              </span>
            </div>
            <div
              className="text-xs truncate mt-0.5"
              style={{ color: 'var(--ink-muted)' }}
              title={detailTags.join(' · ')}
            >
              {weather
                ? detailTags.length > 0
                  ? detailTags.slice(0, 3).join(' · ')
                  : cityDisplay
                : '点击设置精确地区与字段'}
            </div>
          </div>
        </div>

        {slots.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs shrink-0">
            {slots.map((slot, idx) => (
              <div
                key={idx}
                className="px-2 py-1 rounded-xl text-center min-w-[38px]"
                style={{ background: 'var(--pill-bg)' }}
              >
                <div style={{ color: 'var(--ink-muted)' }}>{slot.label}</div>
                <div className="font-mono font-medium">{slot.temp}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </MotionCard>
  );
}
