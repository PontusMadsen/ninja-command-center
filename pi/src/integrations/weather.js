import pino from 'pino';

const logger = pino({ name: 'weather' });

const API_BASE = 'https://api.openweathermap.org/data/2.5';

let weatherState = null;
let pollingTimer = null;

function getConfig() {
  return {
    apiKey: process.env.WEATHER_API_KEY || '',
    city: process.env.WEATHER_CITY || 'Tokyo',
    units: process.env.WEATHER_UNITS || 'metric',
  };
}

export function isConnected() {
  return Boolean(process.env.WEATHER_API_KEY);
}

export function getWeather() {
  return weatherState;
}

async function fetchWeather() {
  const { apiKey, city, units } = getConfig();
  if (!apiKey) {
    logger.warn('WEATHER_API_KEY not set, skipping fetch');
    return;
  }

  try {
    const [currentRes, forecastRes] = await Promise.all([
      fetch(`${API_BASE}/weather?q=${encodeURIComponent(city)}&units=${units}&appid=${apiKey}`),
      fetch(`${API_BASE}/forecast?q=${encodeURIComponent(city)}&units=${units}&appid=${apiKey}&cnt=3`),
    ]);

    if (!currentRes.ok) {
      throw new Error(`Current weather API error: ${currentRes.status} ${currentRes.statusText}`);
    }
    if (!forecastRes.ok) {
      throw new Error(`Forecast API error: ${forecastRes.status} ${forecastRes.statusText}`);
    }

    const current = await currentRes.json();
    const forecast = await forecastRes.json();

    weatherState = {
      temp: current.main.temp,
      feelsLike: current.main.feels_like,
      humidity: current.main.humidity,
      description: current.weather[0].description,
      icon: current.weather[0].icon,
      city: current.name,
      forecast: forecast.list.map((entry) => ({
        time: entry.dt_txt,
        temp: entry.main.temp,
        description: entry.weather[0].description,
        icon: entry.weather[0].icon,
      })),
    };

    logger.info({ city: weatherState.city, temp: weatherState.temp }, 'Weather updated');
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to fetch weather');
    // Keep previous cached state on failure
  }
}

export function startPolling(intervalMs = 600_000) {
  stopPolling();
  // Fetch immediately, then poll
  fetchWeather();
  pollingTimer = setInterval(fetchWeather, intervalMs);
  logger.info({ intervalMs }, 'Weather polling started');
}

export function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    logger.info('Weather polling stopped');
  }
}
