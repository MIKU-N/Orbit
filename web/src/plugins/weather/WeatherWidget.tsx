import { Cloud, CloudLightning, CloudRain, Moon, Snowflake, Sun } from 'lucide-react';
import type { WeatherConfig, WeatherPayload } from '../../types';
import { MotionCard } from '../../sdk/primitives';

interface WeatherWidgetProps {
  weather: WeatherPayload | null;
  config: WeatherConfig;
  enableTilt: boolean;
  layoutEditing: boolean;
  readOnly?: boolean;
  onOpenSettings: () => void;
}

function formatTempVal(c: number, unit: 'C' | 'F'): number {
  return unit === 'F' ? Math.round((c * 9) / 5 + 32) : Math.round(c);
}

export function WeatherWidget({
  weather,
  config,
  enableTilt,
  layoutEditing,
  readOnly = false,
  onOpenSettings,
}: WeatherWidgetProps) {
  const unit = config.unit || 'C';

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
