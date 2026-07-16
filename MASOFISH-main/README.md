# MASOFISH — Vercel-Ready Web App with Live Weather, Tides and Waves

This folder is ready to deploy as a static site on Vercel. It includes the Stitch-based interface, the local TensorFlow.js / Teachable Machine fish-identification model, and live weather data from Open-Meteo.

## Included pages and files

- `index.html` — dashboard with live Cebu City weather summary
- `fish-identification.html` — image upload and AI identification
- `identification-result.html` — prediction results
- `tides-weather.html` — combined weather, estimated tide-height, tide-event and wave-conditions page
- `announcements.html`
- `recipes.html`
- `weather-api.js` — Open-Meteo atmospheric forecast integration and shared weather utilities
- `marine-api.js` — Open-Meteo Marine API integration for sea-level and wave estimates
- `model/` — `model.json`, `metadata.json`, and `weights.bin`

## Weather API

The application calls this endpoint directly from the browser:

```text
https://api.open-meteo.com/v1/forecast?latitude=10.3167&longitude=123.891&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,pressure_msl,weather_code,precipitation_probability&timezone=auto
```

The coordinates point to Cebu City, Philippines. No weather API key or Vercel environment variable is required.

The app displays:

- Current forecast-hour temperature and weather condition
- Wind speed and direction
- Mean sea-level pressure
- Precipitation probability
- A 24-hour temperature chart
- A seven-day summary calculated from the hourly forecast
- A simple weather caution indicator based on upcoming wind, rain, and thunderstorm data

Forecast responses are stored in the browser for 15 minutes. If the live request temporarily fails, the most recent saved forecast may be shown.

### Marine tide and wave module

The combined Tides & Weather page also calls:

```text
https://marine-api.open-meteo.com/v1/marine?latitude=10.3157&longitude=123.8854&hourly=sea_level_height_msl,wave_height&current=wave_height,sea_level_height_msl&timezone=auto
```

It displays the current estimated sea-level height, current wave height, a rising/falling trend, estimated high and low tide events, and a 24-hour tide curve. High and low tide times are calculated from hourly local maxima and minima. These values are planning estimates relative to global mean sea level and must not be used for navigation.


## Deploy using GitHub

1. Create a new GitHub repository.
2. Upload the contents of this folder to the repository root. Do not upload only the outer ZIP.
3. In Vercel, choose **Add New → Project** and import the repository.
4. Use **Other** as the Framework Preset.
5. Leave the Build Command empty.
6. Leave the Output Directory empty so Vercel serves the project root.
7. Select **Deploy**.

## Deploy using the Vercel CLI

From inside this folder:

```bash
npm install -g vercel
vercel
```

For a production deployment:

```bash
vercel --prod
```

## Important notes

- Fish identification runs in the visitor's browser after the model is downloaded.
- No external fish-identification API key is required.
- No Open-Meteo API key is required for the weather or marine integrations.
- The deployed website needs internet access to retrieve current weather data.
- TensorFlow.js, the Teachable Machine image library, Tailwind CSS, Google Fonts, and Material Symbols are currently loaded from public CDNs.
- The fish model currently recognizes Milkfish, Indian Mackerel, Eel, Tilapia, Scatfish, Mullet, Rabbitfish, and No Fish.
- Update the model by replacing the three files inside `model/` while preserving their filenames.
