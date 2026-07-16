(function () {
  'use strict';

  const API_URL = 'https://api.open-meteo.com/v1/forecast?latitude=10.3167&longitude=123.891&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,pressure_msl,weather_code,precipitation_probability&timezone=auto';
  const CACHE_KEY = 'masofish-open-meteo-cebu-v1';
  const CACHE_DURATION_MS = 15 * 60 * 1000;

  const WEATHER_CODES = {
    0: { label: 'Clear sky', icon: 'wb_sunny' },
    1: { label: 'Mainly clear', icon: 'wb_sunny' },
    2: { label: 'Partly cloudy', icon: 'partly_cloudy_day' },
    3: { label: 'Overcast', icon: 'cloud' },
    45: { label: 'Fog', icon: 'foggy' },
    48: { label: 'Rime fog', icon: 'foggy' },
    51: { label: 'Light drizzle', icon: 'rainy_light' },
    53: { label: 'Moderate drizzle', icon: 'rainy' },
    55: { label: 'Dense drizzle', icon: 'rainy' },
    56: { label: 'Freezing drizzle', icon: 'weather_mix' },
    57: { label: 'Dense freezing drizzle', icon: 'weather_mix' },
    61: { label: 'Slight rain', icon: 'rainy_light' },
    63: { label: 'Moderate rain', icon: 'rainy' },
    65: { label: 'Heavy rain', icon: 'rainy_heavy' },
    66: { label: 'Freezing rain', icon: 'weather_mix' },
    67: { label: 'Heavy freezing rain', icon: 'weather_mix' },
    71: { label: 'Slight snow', icon: 'weather_snowy' },
    73: { label: 'Moderate snow', icon: 'weather_snowy' },
    75: { label: 'Heavy snow', icon: 'snowing_heavy' },
    77: { label: 'Snow grains', icon: 'weather_snowy' },
    80: { label: 'Slight rain showers', icon: 'rainy_light' },
    81: { label: 'Moderate rain showers', icon: 'rainy' },
    82: { label: 'Violent rain showers', icon: 'rainy_heavy' },
    85: { label: 'Slight snow showers', icon: 'weather_snowy' },
    86: { label: 'Heavy snow showers', icon: 'snowing_heavy' },
    95: { label: 'Thunderstorm', icon: 'thunderstorm' },
    96: { label: 'Thunderstorm with hail', icon: 'thunderstorm' },
    99: { label: 'Severe thunderstorm with hail', icon: 'thunderstorm' }
  };

  function weatherInfo(code) {
    return WEATHER_CODES[Number(code)] || { label: 'Unknown conditions', icon: 'cloud' };
  }

  function compassDirection(degrees) {
    if (!Number.isFinite(Number(degrees))) return 'N/A';
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(Number(degrees) / 45) % 8];
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function pseudoTimestamp(localIso) {
    return Date.parse(`${localIso}:00Z`);
  }

  function currentIndex(data) {
    const times = data?.hourly?.time || [];
    if (!times.length) return 0;

    const offsetSeconds = Number(data.utc_offset_seconds || 0);
    const localPseudoNow = Date.now() + offsetSeconds * 1000;
    let bestIndex = 0;
    let bestDifference = Number.POSITIVE_INFINITY;

    times.forEach((time, index) => {
      const difference = Math.abs(pseudoTimestamp(time) - localPseudoNow);
      if (difference < bestDifference) {
        bestDifference = difference;
        bestIndex = index;
      }
    });

    return bestIndex;
  }

  function localTimeLabel(localIso) {
    const [, time = ''] = String(localIso).split('T');
    const [hourString = '0', minute = '00'] = time.split(':');
    const hour = Number(hourString);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minute} ${suffix}`;
  }

  function shortHourLabel(localIso) {
    const [, time = ''] = String(localIso).split('T');
    const hour = Number(time.slice(0, 2));
    const suffix = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 || 12} ${suffix}`;
  }

  function dateParts(dateString) {
    const [year, month, day] = String(dateString).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function dayLabel(dateString, firstDate) {
    if (dateString === firstDate) return 'TODAY';
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
      .format(dateParts(dateString))
      .toUpperCase();
  }

  function dateLabel(dateString) {
    return new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC'
    }).format(dateParts(dateString)).toUpperCase();
  }

  function dailySummaries(data) {
    const hourly = data.hourly || {};
    const groups = new Map();

    (hourly.time || []).forEach((time, index) => {
      const date = time.slice(0, 10);
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push(index);
    });

    return Array.from(groups.entries()).slice(0, 7).map(([date, indices]) => {
      const temperatures = indices.map(i => Number(hourly.temperature_2m?.[i])).filter(Number.isFinite);
      const rain = indices.map(i => Number(hourly.precipitation_probability?.[i])).filter(Number.isFinite);
      const winds = indices.map(i => Number(hourly.wind_speed_10m?.[i])).filter(Number.isFinite);
      const noonIndex = indices.find(i => hourly.time?.[i]?.endsWith('12:00')) ?? indices[Math.floor(indices.length / 2)];

      return {
        date,
        high: temperatures.length ? Math.max(...temperatures) : null,
        low: temperatures.length ? Math.min(...temperatures) : null,
        rain: rain.length ? Math.max(...rain) : null,
        wind: winds.length ? Math.max(...winds) : null,
        code: hourly.weather_code?.[noonIndex]
      };
    });
  }

  function nextHours(data, count = 24) {
    const start = currentIndex(data);
    const hourly = data.hourly || {};
    const end = Math.min((hourly.time || []).length, start + count);
    const rows = [];

    for (let index = start; index < end; index += 1) {
      rows.push({
        index,
        time: hourly.time?.[index],
        temperature: Number(hourly.temperature_2m?.[index]),
        windSpeed: Number(hourly.wind_speed_10m?.[index]),
        windDirection: Number(hourly.wind_direction_10m?.[index]),
        pressure: Number(hourly.pressure_msl?.[index]),
        code: Number(hourly.weather_code?.[index]),
        rain: Number(hourly.precipitation_probability?.[index])
      });
    }

    return rows;
  }

  function currentConditions(data) {
    return nextHours(data, 1)[0] || null;
  }

  function cautionSummary(data) {
    const upcoming = nextHours(data, 6);
    if (!upcoming.length) {
      return {
        level: 'unavailable',
        title: 'Weather data unavailable',
        message: 'The latest forecast could not be loaded.'
      };
    }

    const maxWind = Math.max(...upcoming.map(row => row.windSpeed).filter(Number.isFinite), 0);
    const maxRain = Math.max(...upcoming.map(row => row.rain).filter(Number.isFinite), 0);
    const severeCode = upcoming.find(row => [95, 96, 99].includes(row.code));

    if (severeCode) {
      return {
        level: 'danger',
        title: 'Thunderstorm caution',
        message: 'Thunderstorms are forecast within the next six hours. Review official local advisories before going out to sea.'
      };
    }

    if (maxWind >= 30) {
      return {
        level: 'danger',
        title: 'Strong wind caution',
        message: `Wind speeds may reach about ${Math.round(maxWind)} km/h within the next six hours. Consider delaying small-boat activity.`
      };
    }

    if (maxRain >= 70) {
      return {
        level: 'warning',
        title: 'High rain chance',
        message: `Rain probability may reach ${Math.round(maxRain)}% within the next six hours. Bring appropriate safety equipment.`
      };
    }

    return {
      level: 'normal',
      title: 'Weather conditions update',
      message: `No high-risk weather threshold was detected in the next six hours. Continue checking official local advisories.`
    };
  }

  function sparklinePath(values, width = 400, height = 100, padding = 8) {
    const numeric = values.map(Number).filter(Number.isFinite);
    if (numeric.length < 2) return `M${padding},${height / 2} L${width - padding},${height / 2}`;

    const min = Math.min(...numeric);
    const max = Math.max(...numeric);
    const range = max - min || 1;
    return numeric.map((value, index) => {
      const x = padding + (index / (numeric.length - 1)) * (width - padding * 2);
      const y = height - padding - ((value - min) / range) * (height - padding * 2);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  async function fetchForecast(options = {}) {
    const force = Boolean(options.force);
    const cachedText = localStorage.getItem(CACHE_KEY);

    if (!force && cachedText) {
      try {
        const cached = JSON.parse(cachedText);
        if (Date.now() - cached.savedAt < CACHE_DURATION_MS && cached.data) {
          return { data: cached.data, source: 'cache', savedAt: cached.savedAt };
        }
      } catch (_) {
        localStorage.removeItem(CACHE_KEY);
      }
    }

    try {
      const response = await fetch(API_URL, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Weather service returned HTTP ${response.status}.`);
      const data = await response.json();

      if (!data?.hourly?.time?.length) throw new Error('Weather service returned incomplete forecast data.');

      const savedAt = Date.now();
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt, data }));
      return { data, source: 'network', savedAt };
    } catch (error) {
      if (cachedText) {
        try {
          const cached = JSON.parse(cachedText);
          if (cached.data) return { data: cached.data, source: 'stale-cache', savedAt: cached.savedAt, warning: error.message };
        } catch (_) {
          // Ignore invalid cache and rethrow the network error below.
        }
      }
      throw error;
    }
  }

  window.MASOFISH_WEATHER = {
    API_URL,
    fetchForecast,
    weatherInfo,
    compassDirection,
    currentIndex,
    currentConditions,
    nextHours,
    dailySummaries,
    cautionSummary,
    sparklinePath,
    localTimeLabel,
    shortHourLabel,
    dayLabel,
    dateLabel,
    escapeHtml
  };
})();
