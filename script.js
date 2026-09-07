const state = {
  currency: 'usd',
  coins: [],
  cachedCoins: [],
  prevCoins: [],
  portfolio: {},
  watchlist: [],
  transactions: [],
  portfolioHistory: [],
  alerts: [],
  filterQuery: '',
  lastFetch: null,
  sortKey: 'market_cap_rank',
  sortDir: 'asc',
  page: 1,
  perPage: 20,
  isLoading: false,
  countdownInterval: null,
  refreshCountdown: 60,
  theme: 'dark',
  activeTab: 'all',
  selectedCoin: null,
  compareCoins: [],
  compareRange: 7,
  detailRange: 7,
  detailChart: null,
  compareChart: null,
  portfolioChart: null,
  globalData: null,
  fngData: null,
  fetchAbort: null,
  exchangeRates: { USD: 1, EUR: 1, RON: 1 } 
};

const currencySymbols = { usd: '$', eur: '€', ron: ' lei' };
const allocationColors = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#14b8a6'];

function loadStorage() {
  try {
    const t = localStorage.getItem('crypto_theme'); if (t) state.theme = t;
    const c = localStorage.getItem('crypto_currency'); if (c) state.currency = c;
    const w = localStorage.getItem('crypto_watchlist'); if (w) state.watchlist = JSON.parse(w);
    const tx = localStorage.getItem('crypto_transactions_v3'); if (tx) state.transactions = JSON.parse(tx);
    const ph = localStorage.getItem('crypto_portfolio_history'); if (ph) state.portfolioHistory = JSON.parse(ph);
    const cc = localStorage.getItem('crypto_cached_prices'); if (cc) state.cachedCoins = JSON.parse(cc);
    const al = localStorage.getItem('crypto_alerts'); if (al) state.alerts = JSON.parse(al);
    recalcPortfolio();
  } catch (e) { console.error('Storage load error', e); }
}

function saveTransactions() { localStorage.setItem('crypto_transactions_v3', JSON.stringify(state.transactions)); recalcPortfolio(); }
function saveWatchlist() { localStorage.setItem('crypto_watchlist', JSON.stringify(state.watchlist)); }
function saveTheme() { localStorage.setItem('crypto_theme', state.theme); }
function saveCurrency() { localStorage.setItem('crypto_currency', state.currency); }
function savePortfolioHistory() { localStorage.setItem('crypto_portfolio_history', JSON.stringify(state.portfolioHistory)); }

function recalcPortfolio() {
  const holdings = {};
  state.transactions.forEach(tx => {
    if (!holdings[tx.coinId]) holdings[tx.coinId] = { amount: 0, costBasis: 0 };
    if (tx.type === 'buy') {
      holdings[tx.coinId].amount += tx.amount;
      holdings[tx.coinId].costBasis += tx.amount * tx.price;
    } else { holdings[tx.coinId].amount -= tx.amount; }
  });
  state.portfolio = {};
  for (const [coinId, h] of Object.entries(holdings)) {
    if (h.amount > 0.00000001) state.portfolio[coinId] = { amount: h.amount, avgCost: h.costBasis / h.amount };
  }
}

function getCoinPrice(coinId) {
  const coin = state.coins.find(c => c.id === coinId) || state.cachedCoins.find(c => c.id === coinId);
  return coin ? coin.current_price : 0;
}

function getCoinById(coinId) { return state.coins.find(c => c.id === coinId) || state.cachedCoins.find(c => c.id === coinId); }

function takePortfolioSnapshot() {
  const today = new Date().toISOString().slice(0,10);
  const last = state.portfolioHistory[state.portfolioHistory.length - 1];
  if (last && last.date === today) return;

  let totalValue = 0;
  Object.entries(state.portfolio).forEach(([coinId, entry]) => { totalValue += getCoinPrice(coinId) * entry.amount; });
  state.portfolioHistory.push({ date: today, value: totalValue });
  if (state.portfolioHistory.length > 90) state.portfolioHistory.shift();
  savePortfolioHistory();
}

async function fetchExchangeRates() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error('Failed to fetch exchange rates');
    const data = await res.json();
    if (data && data.rates) {
      state.exchangeRates = data.rates;
      updateConverter();
    }
  } catch (err) { console.error("Exchange rate error:", err); }
}

async function fetchMarketData(page = 1, append = false) {
  if (state.isLoading) return;
  state.isLoading = true;
  const refreshBtn = document.getElementById('btn-refresh');
  if (!append && refreshBtn) refreshBtn.classList.add('spinning');

  if (state.fetchAbort) state.fetchAbort.abort();
  state.fetchAbort = new AbortController();

  try {
    const cgUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${state.currency}&order=market_cap_desc&per_page=${state.perPage}&page=${page}&sparkline=true&price_change_percentage=24h`;
    const res = await fetch(cgUrl, { signal: state.fetchAbort.signal });
    if (!res.ok) throw new Error(`CoinGecko status ${res.status}`);

    const data = await res.json();
    handleSuccessfulFetch(data, append);
    showToast('Market data refreshed', 'success');
    return;
  } catch (cgErr) {
    if (cgErr.name === 'AbortError') return;
    console.warn('CoinGecko blocked or failed, attempting CoinCap fallback...', cgErr);
  }

  try {
    const ccRes = await fetch(`https://api.coincap.io/v2/assets?limit=${state.perPage}`);
    if (!ccRes.ok) throw new Error(`CoinCap status ${ccRes.status}`);

    const ccJson = await ccRes.json();
    const normalizedData = ccJson.data.map((c, index) => {
      const priceUSD = parseFloat(c.priceUsd) || 0;
      const rate = state.exchangeRates[state.currency.toUpperCase()] || 1;
      const convertedPrice = priceUSD * rate;

      return {
        id: c.id, symbol: c.symbol.toLowerCase(), name: c.name,
        image: `https://assets.coincap.io/assets/icons/${c.symbol.toLowerCase()}@2x.png`,
        current_price: convertedPrice, market_cap: (parseFloat(c.marketCapUsd) || 0) * rate,
        market_cap_rank: parseInt(c.rank) || (index + 1), total_volume: (parseFloat(c.volumeUsd24Hr) || 0) * rate,
        price_change_percentage_24h: parseFloat(c.changePercent24Hr) || 0,
        sparkline_in_7d: { price: [] }, circulating_supply: parseFloat(c.supply) || 0,
        ath: convertedPrice, atl: 0
      };
    });

    handleSuccessfulFetch(normalizedData, append);
    showToast('CoinGecko rate-limited. Loaded via CoinCap backup.', 'warning');
  } catch (fallbackErr) {
    state.isLoading = false;
    if (refreshBtn) refreshBtn.classList.remove('spinning');
    if (state.cachedCoins.length > 0 && !append) {
      state.coins = state.cachedCoins; renderAll(); showToast('Offline mode: showing cached prices', 'warning');
    } else {
      showToast('All crypto APIs are temporarily unreachable. Retrying in 60s...', 'error');
    }
    startAutoRefresh(60);
  }
}

function handleSuccessfulFetch(data, append) {
  const refreshBtn = document.getElementById('btn-refresh');
  state.prevCoins = append ? [...state.coins] : [...state.coins];
  if (append) {
    const existing = new Set(state.coins.map(c => c.id));
    state.coins = [...state.coins, ...data.filter(c => !existing.has(c.id))];
  } else {
    state.coins = data; state.page = 1;
  }
  state.lastFetch = Date.now();
  state.isLoading = false;
  if (refreshBtn) refreshBtn.classList.remove('spinning');

  localStorage.setItem('crypto_cached_prices', JSON.stringify(state.coins));
  state.cachedCoins = state.coins;
  takePortfolioSnapshot(); renderAll(); startAutoRefresh(60);
}

async function fetchGlobalData() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/global');
    if (res.ok) { state.globalData = await res.json(); renderTicker(); }
  } catch (e) {}
}

async function fetchFearGreed() {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1');
    if (res.ok) {
      const data = await res.json();
      if (data.data && data.data[0]) { state.fngData = data.data[0]; renderFearGreed(); }
    }
  } catch (e) {}
}

const chartCache = {};

async function fetchCoinChart(coinId, days) {
  const cacheKey = `${coinId}-${state.currency}-${days}`;
  if (chartCache[cacheKey]) return chartCache[cacheKey];

  let prices = [];
  const coin = getCoinById(coinId);
  const symbol = coin ? coin.symbol.toUpperCase() : '';

  try {
    const cgRes = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=${state.currency}&days=${days}`);
    if (!cgRes.ok) throw new Error('CG_FAIL');
    const data = await cgRes.json();
    prices = data.prices.map(p => ({ x: p[0], y: p[1] }));
  } catch (cgErr) {
    try {
      let interval = 'd1';
      if (days <= 1) interval = 'm5'; else if (days <= 7) interval = 'h2'; else if (days <= 30) interval = 'h12';
      const end = Date.now(), start = end - (days * 24 * 60 * 60 * 1000);
      const ccRes = await fetch(`https://api.coincap.io/v2/assets/${coinId}/history?interval=${interval}&start=${start}&end=${end}`);
      if (!ccRes.ok) throw new Error('CC_FAIL');
      const ccJson = await ccRes.json();
      const rate = state.exchangeRates[state.currency.toUpperCase()] || 1;
      prices = ccJson.data.map(p => ({ x: p.time, y: parseFloat(p.priceUsd) * rate }));
    } catch (ccErr) {
      try {
        if (!symbol) throw new Error('NO_SYMBOL');
        let bInterval = '1d';
        if (days <= 1) bInterval = '5m'; else if (days <= 7) bInterval = '2h'; else if (days <= 30) bInterval = '12h';
        const binanceRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=${bInterval}&limit=500`);
        if (!binanceRes.ok) throw new Error('BINANCE_FAIL');
        const bData = await binanceRes.json();
        const rate = state.exchangeRates[state.currency.toUpperCase()] || 1;
        prices = bData.map(kline => ({ x: kline[0], y: parseFloat(kline[4]) * rate }));
      } catch (binanceErr) {
        showToast('Failed to load chart (All APIs rate-limited)', 'error'); return [];
      }
    }
  }

  if (prices.length > 0) {
    chartCache[cacheKey] = prices;
    setTimeout(() => delete chartCache[cacheKey], 180000); 
  }
  return prices;
}

const livePrices = new WebSocket('wss://ws.coincap.io/prices?assets=ALL');
livePrices.onmessage = function (msg) {
  const data = JSON.parse(msg.data);
  for (const [coinId, priceStr] of Object.entries(data)) {
    const newPrice = parseFloat(priceStr);
    const coinIndex = state.coins.findIndex(c => c.id === coinId);
    if (coinIndex !== -1) { state.coins[coinIndex].current_price = newPrice; }

    const row = document.querySelector(`tr[data-coin="${coinId}"]`);
    if (row) {
      const priceCell = row.querySelector('td:nth-child(3) strong');
      const oldPrice = parseFloat(priceCell.textContent.replace(/[^0-9.-]+/g,""));
      
      if (oldPrice !== newPrice) {
        priceCell.textContent = formatCurrency(newPrice);
        row.classList.remove('flash-up', 'flash-down');
        void row.offsetWidth;
        row.classList.add(newPrice > oldPrice ? 'flash-up' : 'flash-down');
      }
      checkPriceAlerts(coinId, newPrice);
    }
  }
};

if (Notification.permission !== "granted" && Notification.permission !== "denied") {
  Notification.requestPermission();
}

function checkPriceAlerts(coinId, currentPrice) {
  state.alerts.forEach((alert, index) => {
    if (alert.coinId === coinId && !alert.triggered) {
      if ((alert.direction === 'up' && currentPrice >= alert.price) || (alert.direction === 'down' && currentPrice <= alert.price)) {
        new Notification("🚨 Crypto Price Alert!", {
          body: `${coinId.toUpperCase()} just hit ${formatCurrency(currentPrice)}!`,
          icon: getCoinById(coinId)?.image
        });
        state.alerts[index].triggered = true;
        localStorage.setItem('crypto_alerts', JSON.stringify(state.alerts));
      }
    }
  });
}

document.getElementById('btn-set-alert').addEventListener('click', () => openModal('modal-alert'));
document.getElementById('btn-save-alert').addEventListener('click', () => {
  const targetPrice = parseFloat(document.getElementById('alert-price').value);
  const coin = getCoinById(state.selectedCoin);
  
  if (targetPrice && coin) {
    state.alerts.push({ coinId: coin.id, price: targetPrice, direction: targetPrice > coin.current_price ? 'up' : 'down', triggered: false });
    localStorage.setItem('crypto_alerts', JSON.stringify(state.alerts));
    showToast(`Alert set for ${coin.symbol.toUpperCase()} at ${formatCurrency(targetPrice)}`, 'success');
    closeModal('modal-alert'); document.getElementById('alert-price').value = '';
  }
});

function startAutoRefresh(seconds = 60) {
  if (state.countdownInterval) clearInterval(state.countdownInterval);
  state.refreshCountdown = seconds;
  updateRefreshBadge();

  state.countdownInterval = setInterval(() => {
    state.refreshCountdown--; updateRefreshBadge();
    if (state.refreshCountdown <= 0) fetchMarketData();
  }, 1000);
}

function updateRefreshBadge() {
  const badge = document.getElementById('refresh-badge');
  badge.textContent = `⏱ ${state.refreshCountdown}s`;
  badge.classList.toggle('stale', (!state.lastFetch || (Date.now() - state.lastFetch > 300000)));
}

function formatCurrency(num) {
  if (num === undefined || num === null || isNaN(num)) return '—';
  const symbol = currencySymbols[state.currency];
  const abs = Math.abs(num);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: abs < 1 && abs > 0 ? 4 : 2, maximumFractionDigits: abs < 1 && abs > 0 ? 4 : 2 });
  const sign = num < 0 ? '-' : '';
  return state.currency === 'ron' ? `${sign}${formatted}${symbol}` : `${sign}${symbol}${formatted}`;
}

function formatLargeNumber(num) {
  const symbol = currencySymbols[state.currency];
  if (!num) return '—';
  if (num >= 1e12) return `${symbol}${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `${symbol}${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${symbol}${(num / 1e6).toFixed(2)}M`;
  return formatCurrency(num);
}
function formatPercent(num) { return num === undefined || num === null ? '0.00%' : `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`; }

function renderSparkline(prices) {
  if (!prices || prices.length < 2) return '';
  const min = Math.min(...prices), max = Math.max(...prices), range = max - min || 1;
  const pts = prices.map((p, i) => `${(i / (prices.length - 1)) * 110},${36 - ((p - min) / range) * 32 - 2}`).join(' ');
  const color = prices[prices.length - 1] >= prices[0] ? '#10b981' : '#ef4444';
  return `<svg class="sparkline" viewBox="0 0 110 36" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/></svg>`;
}

function renderTicker() {
  if (!state.globalData?.data) return;
  const d = state.globalData.data;
  document.getElementById('ticker-mc').textContent = `MCap: ${formatLargeNumber(d.total_market_cap[state.currency])}`;
  document.getElementById('ticker-vol').textContent = `Vol: ${formatLargeNumber(d.total_volume[state.currency])}`;
  document.getElementById('ticker-btc').textContent = `BTC Dom: ${d.market_cap_percentage.btc.toFixed(1)}%`;
}

function renderFearGreed() {
  if (!state.fngData) return;
  const card = document.getElementById('fng-card'), val = parseInt(state.fngData.value);
  card.style.display = 'block';
  document.getElementById('fng-value').textContent = `${val} — ${state.fngData.value_classification}`;
  document.getElementById('fng-fill').style.left = `calc(${val}% - 8px)`;
}

function getSortedCoins() {
  let coins = [...state.coins];
  if (state.activeTab === 'watchlist') coins = coins.filter(c => state.watchlist.includes(c.id));
  else if (state.activeTab === 'portfolio') coins = coins.filter(c => state.portfolio[c.id]);
  if (state.filterQuery) {
    const q = state.filterQuery.toLowerCase();
    coins = coins.filter(c => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q));
  }
  coins.sort((a, b) => {
    let av = a[state.sortKey] ?? -Infinity, bv = b[state.sortKey] ?? -Infinity;
    if (typeof av === 'string') av = av.toLowerCase(); if (typeof bv === 'string') bv = bv.toLowerCase();
    return (av < bv ? -1 : (av > bv ? 1 : 0)) * (state.sortDir === 'asc' ? 1 : -1);
  });
  return coins;
}

function renderTable() {
  const tbody = document.getElementById('crypto-table-body'), coins = getSortedCoins();
  if (!coins.length) { tbody.innerHTML = `<tr><td colspan="8" class="status-cell">No cryptocurrencies found.</td></tr>`; return; }

  tbody.innerHTML = coins.map((c, i) => {
    const isUp = (c.price_change_percentage_24h || 0) >= 0;
    const isStarred = state.watchlist.includes(c.id);
    let flashClass = '';
    const prev = state.prevCoins.find(p => p.id === c.id);
    if (prev && prev.current_price !== c.current_price) flashClass = c.current_price > prev.current_price ? 'flash-up' : 'flash-down';

    return `
      <tr data-coin="${c.id}" class="${flashClass}">
        <td>${c.market_cap_rank || i + 1}</td>
        <td><div class="coin-info"><img src="${c.image}" alt="${c.name}" loading="lazy"><div><div class="coin-name">${c.name}</div><div class="coin-symbol">${c.symbol}</div></div></div></td>
        <td><strong>${formatCurrency(c.current_price)}</strong></td>
        <td class="${isUp ? 'price-up' : 'price-down'}">${formatPercent(c.price_change_percentage_24h)}</td>
        <td class="hide-mobile">${formatLargeNumber(c.total_volume)}</td>
        <td class="hide-mobile">${formatLargeNumber(c.market_cap)}</td>
        <td class="hide-mobile sparkline-cell">${c.sparkline_in_7d?.price ? renderSparkline(c.sparkline_in_7d.price) : ''}</td>
        <td><button class="star-btn ${isStarred ? 'active' : ''}" data-action="toggle-star" data-id="${c.id}">${isStarred ? '★' : '☆'}</button></td>
      </tr>`;
  }).join('');
  
  setTimeout(() => { tbody.querySelectorAll('.flash-up, .flash-down').forEach(el => el.classList.remove('flash-up', 'flash-down')); }, 1200);
}

function renderPortfolio() {
  const container = document.getElementById('portfolio-holdings'), totalElem = document.getElementById('portfolio-total'), subElem = document.getElementById('portfolio-sub'), allocBar = document.getElementById('allocation-bar'), chartWrap = document.getElementById('portfolio-chart-wrap');
  const keys = Object.keys(state.portfolio);

  if (!keys.length) {
    container.innerHTML = `<p class="empty-hint">No assets added yet.</p>`;
    totalElem.textContent = formatCurrency(0); subElem.textContent = '0 assets';
    allocBar.style.display = 'none'; chartWrap.style.display = 'none'; return;
  }

  let totalValue = 0, totalCost = 0; const data = [];
  keys.forEach(coinId => {
    const entry = state.portfolio[coinId], value = getCoinPrice(coinId) * entry.amount, cost = entry.avgCost * entry.amount, pnl = value - cost;
    totalValue += value; totalCost += cost;
    data.push({ coinId, symbol: getCoinById(coinId)?.symbol || coinId, amount: entry.amount, value, cost, pnl, pnlPct: cost > 0 ? (pnl / cost) * 100 : 0 });
  });
  data.sort((a, b) => b.value - a.value);

  allocBar.style.display = 'flex';
  allocBar.innerHTML = data.map((h, i) => `<div class="allocation-segment" style="width:${totalValue > 0 ? (h.value / totalValue) * 100 : 0}%;background:${allocationColors[i % allocationColors.length]}" title="${h.symbol.toUpperCase()}"></div>`).join('');

  if (state.portfolioHistory.length > 1) { chartWrap.style.display = 'block'; renderPortfolioChart(); } else { chartWrap.style.display = 'none'; }

  container.innerHTML = data.map(h => `
      <div class="holding-chip" data-id="${h.coinId}">
        <span class="holding-amount">${h.amount.toLocaleString('en-US', {maximumFractionDigits: 6})}</span>
        <span class="holding-symbol">${h.symbol}</span>
        <span class="holding-value">${formatCurrency(h.value)}</span>
        ${h.cost > 0 ? `<span class="holding-pnl ${h.pnl >= 0 ? 'profit' : 'loss'}">${h.pnl >= 0 ? '+' : ''}${formatCurrency(h.pnl)} (${h.pnl >= 0 ? '+' : ''}${h.pnlPct.toFixed(1)}%)</span>` : ''}
        <span class="holding-remove" data-action="remove-holding" data-id="${h.coinId}">×</span>
      </div>`).join('');

  totalElem.textContent = formatCurrency(totalValue);
  const totalPnl = totalValue - totalCost, totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0, pnlSign = totalPnl >= 0 ? '+' : '';
  subElem.innerHTML = `${keys.length} asset${keys.length > 1 ? 's' : ''}${totalCost > 0 ? ` · ${pnlSign}${formatCurrency(totalPnl)} (${pnlSign}${totalPnlPct.toFixed(1)}%)` : ''}`;
}

function updateConverter() {
  const fromId = document.getElementById('conv-from').value, amount = parseFloat(document.getElementById('conv-amount').value) || 0, toCurr = document.getElementById('conv-to').value.toUpperCase();
  const coin = getCoinById(fromId);
  if (!coin || !amount) { document.getElementById('conv-result').textContent = '—'; return; }

  let priceInUSD = coin.current_price;
  if (state.currency.toUpperCase() !== 'USD') priceInUSD = coin.current_price / (state.exchangeRates[state.currency.toUpperCase()] || 1);
  const result = (priceInUSD * amount) * (state.exchangeRates[toCurr] || 1);
  const symbol = currencySymbols[toCurr.toLowerCase()] || toCurr;
  document.getElementById('conv-result').textContent = toCurr === 'RON' ? `${result.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${symbol}` : `${symbol}${result.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getChartColors() { 
  return { grid: state.theme === 'dark' ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.15)', text: state.theme === 'dark' ? '#64748b' : '#94a3b8', line: '#6366f1', fill: state.theme === 'dark' ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.1)' }; 
}

function getTooltipConfig() {
  return {
    backgroundColor: state.theme === 'dark' ? 'rgba(21, 29, 48, 0.85)' : 'rgba(255, 255, 255, 0.9)',
    titleColor: state.theme === 'dark' ? '#f1f5f9' : '#0f172a',
    bodyColor: state.theme === 'dark' ? '#94a3b8' : '#475569',
    borderColor: 'rgba(99, 102, 241, 0.3)',
    borderWidth: 1, padding: 12, cornerRadius: 8, displayColors: false
  };
}

function renderPortfolioChart() {
  const ctx = document.getElementById('portfolio-chart').getContext('2d'), colors = getChartColors();
  if (state.portfolioChart) state.portfolioChart.destroy();
  state.portfolioChart = new Chart(ctx, {
    type: 'line', data: { labels: state.portfolioHistory.map(h => h.date.slice(5)), datasets: [{ data: state.portfolioHistory.map(h => h.value), borderColor: colors.line, backgroundColor: colors.fill, borderWidth: 2, fill: true, tension: 0.4, pointRadius: 3 }] },
    options: { 
      responsive: true, maintainAspectRatio: false, 
      plugins: { 
        legend: { display: false }, 
        tooltip: { ...getTooltipConfig(), callbacks: { label: ctx => formatCurrency(ctx.raw).replace(/\.00$/, '') } } 
      }, 
      scales: { x: { grid: { color: colors.grid }, ticks: { color: colors.text, font: { size: 10 } } }, y: { grid: { color: colors.grid }, ticks: { color: colors.text, font: { size: 10 }, callback: v => formatCurrency(v).replace(/\.00$/, '') } } }, interaction: { intersect: false, mode: 'index' } 
    }
  });
}

async function renderDetailChart(coinId, days) {
  const prices = await fetchCoinChart(coinId, days);
  if (!prices.length) return;

  const ctx = document.getElementById('detail-chart').getContext('2d');
  const colors = getChartColors();
  const isUp = prices[prices.length - 1].y >= prices[0].y;
  const lineColor = isUp ? '#10b981' : '#ef4444';
  const fillColor = isUp ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)';

  if (state.detailChart) state.detailChart.destroy();

  state.detailChart = new Chart(ctx, {
    type: 'line',
    data: { datasets: [{ label: 'Price', data: prices, borderColor: lineColor, backgroundColor: fillColor, borderWidth: 2.5, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { ...getTooltipConfig(), callbacks: { label: ctx => formatCurrency(ctx.raw.y) } } },
      scales: { x: { type: 'linear', display: false }, y: { grid: { color: colors.grid }, ticks: { color: colors.text, font: { size: 10 }, callback: v => formatCurrency(v).replace(/\.00$/, '') } } },
      interaction: { intersect: false, mode: 'index' }
    }
  });
}

async function renderCompareChart() {
  if (state.compareCoins.length < 2) return;
  const ctx = document.getElementById('compare-chart').getContext('2d'), colors = getChartColors(), datasets = [], palette = ['#6366f1', '#10b981', '#f59e0b'];
  for (let i = 0; i < state.compareCoins.length; i++) {
    const prices = await fetchCoinChart(state.compareCoins[i], state.compareRange);
    if (!prices.length) continue;
    datasets.push({ label: getCoinById(state.compareCoins[i])?.symbol.toUpperCase() || state.compareCoins[i], data: prices.map(p => ({ x: p.x, y: ((p.y - prices[0].y) / prices[0].y) * 100 })), borderColor: palette[i], borderWidth: 2.5, fill: false, tension: 0.3, pointRadius: 0 });
  }
  if (state.compareChart) state.compareChart.destroy();
  state.compareChart = new Chart(ctx, {
    type: 'line', data: { datasets },
    options: { 
      responsive: true, maintainAspectRatio: false, 
      plugins: { 
        legend: { labels: { color: colors.text } }, 
        tooltip: { ...getTooltipConfig(), callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw.y >= 0 ? '+' : ''}${ctx.raw.y.toFixed(2)}%` } } 
      }, 
      scales: { x: { display: false }, y: { grid: { color: colors.grid }, ticks: { color: colors.text, callback: v => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%` } } }, interaction: { intersect: false, mode: 'index' } 
    }
  });
}

async function openDetailModal(coinId) {
  const coin = getCoinById(coinId); if (!coin) return;
  state.selectedCoin = coinId;
  document.getElementById('detail-img').src = coin.image;
  document.getElementById('detail-name').textContent = coin.name;
  document.getElementById('detail-symbol').textContent = coin.symbol.toUpperCase();
  document.getElementById('detail-price').textContent = formatCurrency(coin.current_price);
  
  const change = document.getElementById('detail-change');
  change.textContent = formatPercent(coin.price_change_percentage_24h); 
  change.className = `detail-change ${(coin.price_change_percentage_24h || 0) >= 0 ? 'up' : 'down'}`;
  
  document.getElementById('detail-stats').innerHTML = `
    <div class="detail-stat"><div class="detail-stat-label"><span class="detail-stat-icon">🏦</span>Market Cap</div><div class="detail-stat-value">${formatLargeNumber(coin.market_cap)}</div></div>
    <div class="detail-stat"><div class="detail-stat-label"><span class="detail-stat-icon">🌊</span>24h Volume</div><div class="detail-stat-value">${formatLargeNumber(coin.total_volume)}</div></div>
    <div class="detail-stat"><div class="detail-stat-label"><span class="detail-stat-icon">🔄</span>Circulating</div><div class="detail-stat-value">${coin.circulating_supply ? (coin.circulating_supply / 1e6).toFixed(2) + 'M' : '—'}</div></div>
    <div class="detail-stat"><div class="detail-stat-label"><span class="detail-stat-icon">🚀</span>ATH</div><div class="detail-stat-value">${formatCurrency(coin.ath)}</div></div>
    <div class="detail-stat"><div class="detail-stat-label"><span class="detail-stat-icon">⚓</span>ATL</div><div class="detail-stat-value">${formatCurrency(coin.atl)}</div></div>
    <div class="detail-stat"><div class="detail-stat-label"><span class="detail-stat-icon">🏆</span>Rank</div><div class="detail-stat-value">#${coin.market_cap_rank || '—'}</div></div>
  `;
  
  openModal('modal-detail');
  await renderDetailChart(coinId, state.detailRange);
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container'), toast = document.createElement('div');
  toast.className = `toast ${type}`; toast.textContent = message; container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  document.getElementById('btn-theme').textContent = state.theme === 'dark' ? '🌙' : '☀️';
  saveTheme();
  if (state.portfolioChart) renderPortfolioChart();
  if (state.detailChart && state.selectedCoin) renderDetailChart(state.selectedCoin, state.detailRange);
  if (state.compareChart && state.compareCoins.length >= 2) renderCompareChart();
}

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function renderAll() {
  renderTable(); renderPortfolio(); 
  document.getElementById('conv-from').innerHTML = '<option value="" disabled>Choose coin...</option>' + state.coins.map(c => `<option value="${c.id}">${c.name} (${c.symbol.toUpperCase()})</option>`).join('');
  if (state.coins.length) document.getElementById('conv-from').value = state.coins[0].id; updateConverter();
  document.getElementById('coin-select').innerHTML = '<option value="" disabled selected>Choose a coin...</option>' + state.coins.map(c => `<option value="${c.id}">${c.name} (${c.symbol.toUpperCase()})</option>`).join('');
  document.getElementById('compare-chips').innerHTML = state.coins.slice(0, 50).map(c => `<button class="compare-chip ${state.compareCoins.includes(c.id) ? 'selected' : ''}" data-id="${c.id}">${c.symbol.toUpperCase()}</button>`).join('');
  document.getElementById('last-updated').innerHTML = (!state.lastFetch || (Date.now() - state.lastFetch > 300000)) ? `<span style="color:var(--warning)">⚠ Stale</span>` : `Updated: ${new Date(state.lastFetch).toLocaleTimeString()}`;
  document.getElementById('load-more-row').style.display = state.activeTab === 'all' ? 'block' : 'none';
}

document.getElementById('btn-theme').addEventListener('click', toggleTheme);
document.getElementById('crypto-search').addEventListener('input', (e) => { state.filterQuery = e.target.value.trim(); renderTable(); });
document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => { document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); state.activeTab = btn.dataset.tab; if (state.activeTab === 'compare') { openModal('modal-compare'); renderCompareChart(); setTimeout(() => document.querySelector('.tab-btn[data-tab="all"]').click(), 0); return; } renderTable(); }));
document.querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', () => { const key = th.dataset.sort; if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'; else { state.sortKey = key; state.sortDir = 'desc'; } document.querySelectorAll('th.sortable').forEach(t => { t.classList.remove('sort-asc', 'sort-desc'); t.querySelector('.sort-icon').textContent = '↕'; }); th.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc'); th.querySelector('.sort-icon').textContent = state.sortDir === 'asc' ? '↑' : '↓'; renderTable(); }));
document.getElementById('currency-toggle').addEventListener('click', (e) => { if (e.target.dataset.curr && e.target.dataset.curr !== state.currency) { state.currency = e.target.dataset.curr; document.querySelectorAll('.curr-btn').forEach(b => b.classList.remove('active')); e.target.classList.add('active'); saveCurrency(); fetchMarketData(); } });
document.getElementById('btn-refresh').addEventListener('click', () => fetchMarketData());
document.getElementById('btn-load-more').addEventListener('click', () => { state.page++; fetchMarketData(state.page, true); });
document.getElementById('conv-amount').addEventListener('input', updateConverter); document.getElementById('conv-from').addEventListener('change', updateConverter); document.getElementById('conv-to').addEventListener('change', updateConverter);
document.getElementById('btn-open-modal').addEventListener('click', () => { document.getElementById('portfolio-form').reset(); document.getElementById('coin-select').value = ''; document.getElementById('tx-date').value = new Date().toISOString().slice(0, 10); openModal('modal-asset'); });
document.getElementById('btn-history').addEventListener('click', () => { document.getElementById('history-list').innerHTML = state.transactions.length ? [...state.transactions].sort((a, b) => new Date(b.date) - new Date(a.date)).map(tx => `<div class="history-item"><span class="history-icon">${tx.type === 'buy' ? '🟢' : '🔴'}</span><div class="history-info"><div class="history-coin">${getCoinById(tx.coinId)?.name || tx.coinId}</div><div class="history-meta">${tx.date} · @ ${formatCurrency(tx.price)}</div></div><span class="history-amount ${tx.type}">${tx.type === 'buy' ? '+' : '-'}${tx.amount}</span><span class="history-delete" data-action="delete-tx" data-id="${tx.id}">🗑</span></div>`).join('') : '<p class="empty-hint">No transactions yet.</p>'; openModal('modal-history'); });
document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', (e) => { if (e.target === o) o.classList.remove('active'); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active')); });

document.getElementById('portfolio-form').addEventListener('submit', (e) => {
  e.preventDefault(); const coinId = document.getElementById('coin-select').value, type = document.getElementById('tx-type').value, amount = parseFloat(document.getElementById('coin-amount').value), date = document.getElementById('tx-date').value;
  let price = parseFloat(document.getElementById('coin-price').value) || getCoinPrice(coinId);
  if (type === 'sell' && amount > (state.portfolio[coinId]?.amount || 0)) return showToast(`Cannot sell more than you hold.`, 'error');
  state.transactions.push({ id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), coinId, type, amount, price, date }); saveTransactions(); renderAll(); closeModal('modal-asset'); showToast('Transaction saved', 'success');
});

document.addEventListener('click', (e) => {
  const action = e.target.dataset.action, id = e.target.dataset.id;
  if (action === 'toggle-star') { e.stopPropagation(); if (state.watchlist.includes(id)) { state.watchlist = state.watchlist.filter(w => w !== id); showToast('Removed from watchlist', 'info'); } else { state.watchlist.push(id); showToast('Added to watchlist', 'success'); } saveWatchlist(); renderTable(); return; }
  if (action === 'remove-holding') { e.stopPropagation(); if (confirm('Remove all transactions for this asset?')) { state.transactions = state.transactions.filter(t => t.coinId !== id); saveTransactions(); renderAll(); } return; }
  if (action === 'delete-tx') { e.stopPropagation(); state.transactions = state.transactions.filter(t => t.id !== id); saveTransactions(); document.getElementById('btn-history').click(); renderPortfolio(); return; }
  const row = e.target.closest('tr[data-coin]'); if (row && !e.target.closest('.star-btn')) openDetailModal(row.dataset.coin);
  if (e.target.classList.contains('compare-chip')) { e.stopPropagation(); const cid = e.target.dataset.id; if (state.compareCoins.includes(cid)) { state.compareCoins = state.compareCoins.filter(c => c !== cid); e.target.classList.remove('selected'); } else if (state.compareCoins.length < 3) { state.compareCoins.push(cid); e.target.classList.add('selected'); } else showToast('Select up to 3 coins', 'warning'); renderCompareChart(); }
  if (e.target.classList.contains('range-btn') && e.target.dataset.range) { document.querySelectorAll('#modal-detail .range-btn').forEach(b => b.classList.remove('active')); e.target.classList.add('active'); state.detailRange = parseInt(e.target.dataset.range); if (state.selectedCoin) renderDetailChart(state.selectedCoin, state.detailRange); }
  if (e.target.classList.contains('range-btn') && e.target.dataset.compareRange) { document.querySelectorAll('#modal-compare .range-btn').forEach(b => b.classList.remove('active')); e.target.classList.add('active'); state.compareRange = parseInt(e.target.dataset.compareRange); renderCompareChart(); }
});

function init() {
  loadStorage();
  document.documentElement.setAttribute('data-theme', state.theme); 
  document.getElementById('btn-theme').textContent = state.theme === 'dark' ? '🌙' : '☀️';
  document.querySelectorAll('.curr-btn').forEach(b => b.classList.toggle('active', b.dataset.curr === state.currency));
  document.getElementById('tx-date').value = new Date().toISOString().slice(0, 10);
  
  fetchExchangeRates();
  fetchMarketData();
  setTimeout(fetchGlobalData, 1200);
  setTimeout(fetchFearGreed, 2400);
  
  setInterval(fetchGlobalData, 120000); 
  setInterval(fetchFearGreed, 300000); 
  setInterval(fetchExchangeRates, 3600000);
}

init();