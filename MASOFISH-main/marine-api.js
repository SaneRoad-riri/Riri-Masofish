(function () {
  'use strict';

  const API_URL = 'https://marine-api.open-meteo.com/v1/marine?latitude=10.3157&longitude=123.8854&hourly=sea_level_height_msl,wave_height&current=wave_height,sea_level_height_msl&timezone=auto';
  const CACHE_KEY = 'masofish_marine_cebu_v1';
  const CACHE_DURATION_MS = 15 * 60 * 1000;

  function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function currentIndex(data) {
    const times = data?.hourly?.time || [];
    const currentTime = data?.current?.time;
    if (!times.length) return -1;
    if (!currentTime) return 0;

    const currentHour = `${currentTime.slice(0, 13)}:00`;
    const exact = times.indexOf(currentHour);
    if (exact >= 0) return exact;

    const next = times.findIndex(time => time >= currentTime);
    return next >= 0 ? next : 0;
  }

  function currentConditions(data) {
    const index = currentIndex(data);
    const times = data?.hourly?.time || [];
    const seaLevels = data?.hourly?.sea_level_height_msl || [];
    const waves = data?.hourly?.wave_height || [];

    const currentSeaLevel = safeNumber(data?.current?.sea_level_height_msl);
    const currentWave = safeNumber(data?.current?.wave_height);
    const hourlySeaLevel = index >= 0 ? safeNumber(seaLevels[index]) : null;
    const nextSeaLevel = index >= 0 && index + 1 < seaLevels.length ? safeNumber(seaLevels[index + 1]) : null;

    let trend = 'steady';
    if (hourlySeaLevel !== null && nextSeaLevel !== null) {
      if (nextSeaLevel > hourlySeaLevel + 0.005) trend = 'rising';
      else if (nextSeaLevel < hourlySeaLevel - 0.005) trend = 'falling';
    }

    return {
      time: data?.current?.time || times[index] || null,
      index,
      seaLevel: currentSeaLevel !== null ? currentSeaLevel : hourlySeaLevel,
      waveHeight: currentWave !== null ? currentWave : (index >= 0 ? safeNumber(waves[index]) : null),
      trend
    };
  }

  function tideEvents(data, maxEvents = 12) {
    const times = data?.hourly?.time || [];
    const values = (data?.hourly?.sea_level_height_msl || []).map(safeNumber);
    const startIndex = Math.max(currentIndex(data), 0);
    const events = [];

    for (let index = Math.max(startIndex, 1); index < values.length - 1; index += 1) {
      const previous = values[index - 1];
      const current = values[index];
      const next = values[index + 1];
      if (previous === null || current === null || next === null) continue;

      const isHigh = (current >= previous && current > next) || (current > previous && current >= next);
      const isLow = (current <= previous && current < next) || (current < previous && current <= next);

      if (isHigh || isLow) {
        events.push({
          type: isHigh ? 'high' : 'low',
          time: times[index],
          height: current,
          index
        });
      }
      if (events.length >= maxEvents) break;
    }

    return events;
  }

  function nextHours(data, count = 24) {
    const times = data?.hourly?.time || [];
    const seaLevels = data?.hourly?.sea_level_height_msl || [];
    const waves = data?.hourly?.wave_height || [];
    const startIndex = Math.max(currentIndex(data), 0);
    const endIndex = Math.min(startIndex + count, times.length);

    return times.slice(startIndex, endIndex).map((time, offset) => ({
      time,
      index: startIndex + offset,
      seaLevel: safeNumber(seaLevels[startIndex + offset]),
      waveHeight: safeNumber(waves[startIndex + offset])
    }));
  }

  function dateForDisplay(localIso) {
    if (!localIso) return null;
    const [datePart, timePart = '00:00'] = String(localIso).split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour, minute));
  }

  function timeLabel(localIso) {
    const date = dateForDisplay(localIso);
    if (!date) return '--';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  }

  function dateLabel(localIso) {
    const date = dateForDisplay(localIso);
    if (!date) return '--';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    }).format(date);
  }

  function waveDescription(height) {
    if (!Number.isFinite(height)) return 'Wave condition unavailable';
    if (height < 0.5) return 'Calm to very slight waves';
    if (height < 1.25) return 'Slight waves';
    if (height < 2.5) return 'Moderate waves';
    if (height < 4) return 'Rough waves';
    return 'Very rough waves';
  }

  async function fetchMarine(options = {}) {
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
      const response = await fetch(API_URL, {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`Marine service returned HTTP ${response.status}.`);

      const data = await response.json();
      if (!data?.hourly?.time?.length || !data?.hourly?.sea_level_height_msl?.length) {
        throw new Error('Marine service returned incomplete tide data.');
      }

      const savedAt = Date.now();
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt, data }));
      return { data, source: 'network', savedAt };
    } catch (error) {
      if (cachedText) {
        try {
          const cached = JSON.parse(cachedText);
          if (cached.data) {
            return {
              data: cached.data,
              source: 'stale-cache',
              savedAt: cached.savedAt,
              warning: error.message
            };
          }
        } catch (_) {
          // Ignore an invalid saved response.
        }
      }
      throw error;
    }
  }

  window.MASOFISH_MARINE = {
    API_URL,
    fetchMarine,
    currentIndex,
    currentConditions,
    tideEvents,
    nextHours,
    timeLabel,
    dateLabel,
    waveDescription
  };
})();
