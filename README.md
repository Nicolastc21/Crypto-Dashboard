# 📊 Live Crypto Dashboard

A sleek, highly resilient, and real-time cryptocurrency tracking dashboard built entirely with vanilla web technologies (HTML, CSS, JavaScript). 

This project goes beyond standard API fetching by implementing a **triple-fallback architecture** and **live WebSockets** to ensure market data and charts always load, completely eliminating the common issue of public API rate-limit crashes.

![Crypto Dashboard Screenshot](<img width="1897" height="842" alt="image" src="https://github.com/user-attachments/assets/3c328c1e-1101-4a37-91cc-c931d358a789" />) 
![The Detail & Chart Modal](<img width="785" height="762" alt="image" src="https://github.com/user-attachments/assets/8fc2e0ee-8999-4295-a646-f107216a9bb3" />).
![The Portfolio Tracker](<img width="1151" height="856" alt="image" src="https://github.com/user-attachments/assets/c389df4a-872e-41b1-b2b2-4ab37cd7217a" />)

## ✨ Key Features

*   ⚡ **Real-Time Prices (WebSockets):** Live, millisecond-level price updates and table flash animations powered by the CoinCap WebSocket stream.
*   🛡️ **Bulletproof API Fallbacks:** A triple-layered fetch architecture (`CoinGecko ➔ CoinCap ➔ Binance`). If one API hits a rate limit, the app gracefully falls back to the next, ensuring historical charts and market data never break.
*   💼 **Portfolio Tracker:** Add buy/sell transactions, track realized/unrealized P&L, and visualize your portfolio's historical value and asset allocation.
*   🔔 **Native Price Alerts:** Set custom price targets and receive native browser push notifications when a coin crosses your threshold.
*   💱 **Live Fiat Conversions:** Real-time global exchange rates (USD, EUR, RON) mapped dynamically to all assets and the quick-convert widget.
*   🎨 **Premium UI/UX:** Glassmorphism design, seamless Dark/Light mode toggle, custom iOS-style segmented controls, and fully responsive layouts.
*   💾 **Local State Management:** Watchlists, portfolios, themes, and alerts are persistently saved in your browser's `localStorage`—no backend database required.

## 🛠️ Tech Stack

*   **Frontend:** Vanilla HTML5, CSS3 (CSS Variables, Backdrop Filters), Vanilla JavaScript (ES6+)
*   **Data Visualization:** [Chart.js](https://www.chartjs.org/) for historical price curves and portfolio tracking
*   **Hosting:** Ready for GitHub Pages / Vercel (Zero build-step required)

## 📡 APIs & Data Sources

This dashboard aggregates data from multiple free, public APIs to create a seamless experience:
*   **[CoinGecko API](https://www.coingecko.com/en/api):** Primary source for market lists, market caps, and initial historical chart data.
*   **[CoinCap API / WebSockets](https://docs.coincap.io/):** Secondary backup for historical data and primary source for live WebSocket price streams.
*   **[Binance API](https://binance-docs.github.io/apidocs/):** Ultimate tertiary backup for historical klines/candlestick chart data due to its massive rate limits.
*   **[ExchangeRate-API](https://www.exchangerate-api.com/):** Live fiat currency conversion rates.
*   **[Alternative.me](https://alternative.me/crypto/fear-and-greed-index/):** Live Fear & Greed index data.

## 🚀 Quick Start / Installation

Because this project uses vanilla web technologies, there are zero build steps, bundlers, or dependencies to install.

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/YourUsername/crypto-dashboard.git](https://github.com/YourUsername/crypto-dashboard.git)
