const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const MARKETS = {
  AUTO: { currency: "" },
  KR: { currency: "KRW", nation: "KOR" },
  US: { currency: "USD", nation: "USA" },
  JP: { currency: "JPY", nation: "JPN" },
  HK: { currency: "HKD", nation: "HKG" },
  CN: { currency: "CNY", nation: "CHN" },
  VN: { currency: "VND", nation: "VNM" },
};

const FX_SYMBOLS = {
  USD: "KRW=X",
  JPY: "JPYKRW=X",
  HKD: "HKDKRW=X",
  CNY: "CNYKRW=X",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/search") {
        const query = (url.searchParams.get("q") || "").trim();
        const market = (url.searchParams.get("market") || "AUTO").toUpperCase();
        return json({ results: query ? await searchSymbols(query, market) : [] });
      }

      if (url.pathname === "/api/quote") {
        const market = (url.searchParams.get("market") || "AUTO").toUpperCase();
        const dateMode = (url.searchParams.get("dateMode") || "TODAY").toUpperCase();
        const candle = (url.searchParams.get("candle") || "D").toUpperCase();
        let symbol = (url.searchParams.get("symbol") || "").trim();
        const query = (url.searchParams.get("q") || "").trim();

        if (!symbol && query) {
          const matches = await searchSymbols(query, market);
          if (matches.length) symbol = matches[0].symbol;
        }
        if (!symbol) return json({ error: "종목명 또는 심볼을 입력해 주세요." }, 400);

        return json(await quoteSymbol(symbol, market, dateMode, candle));
      }

      if (url.pathname === "/api/fx") {
        const amount = parsePrice(url.searchParams.get("amount")) || 0;
        const currency = (url.searchParams.get("to") || "KRW").toUpperCase();
        return json(await convertKrw(amount, currency));
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error.message || "요청 처리 중 오류가 발생했습니다." }, 500);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function httpJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function parsePrice(value) {
  if (value == null) return null;
  const number = Number(String(value).replaceAll(",", "").replace("%", "").trim());
  return Number.isFinite(number) ? number : null;
}

function normalizeTradingDate(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return text.split(" ")[0];
}

function tradingDateFromTimestamp(timestamp, timezoneName) {
  if (timestamp == null) return null;
  const number = Number(timestamp);
  if (!Number.isFinite(number)) return normalizeTradingDate(timestamp);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezoneName || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(number * 1000));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return new Date(number * 1000).toISOString().slice(0, 10);
  }
}

function marketFromNation(nationCode) {
  return {
    KOR: "KR",
    USA: "US",
    JPN: "JP",
    HKG: "HK",
    CHN: "CN",
    VNM: "VN",
  }[nationCode] || "AUTO";
}

function yahooSymbolFromNaver(item) {
  const nation = item.nationCode;
  const code = String(item.code || "").trim();
  const reuters = String(item.reutersCode || "").trim();
  const typeCode = String(item.typeCode || "").toUpperCase();
  if (nation === "KOR") return `${code}.${typeCode === "KOSDAQ" || typeCode === "KONEX" ? "KQ" : "KS"}`;
  if (nation === "USA") return code;
  return reuters || code;
}

function naverDomesticCode(symbol) {
  const match = String(symbol).trim().toUpperCase().match(/(\d{5,6})(?:\.(?:KS|KQ))?$/);
  return match ? match[1].padStart(6, "0") : null;
}

function normalizeSymbol(symbol, market) {
  const normalized = String(symbol).trim().toUpperCase();
  if (!normalized) return [];
  if (normalized.includes(".") || normalized.includes("-")) return [normalized];
  if (market === "KR" && /^\d{5,6}$/.test(normalized)) {
    return [`${normalized.padStart(6, "0")}.KS`, `${normalized.padStart(6, "0")}.KQ`];
  }
  if (market === "JP" && /^\d{4}$/.test(normalized)) return [`${normalized}.T`];
  if (market === "HK" && /^\d{1,5}$/.test(normalized)) return [`${normalized.padStart(4, "0")}.HK`];
  if (market === "CN" && /^\d{6}$/.test(normalized)) return [`${normalized}.${normalized.startsWith("6") ? "SS" : "SZ"}`];
  if (market === "VN") return [`${normalized}.VN`, normalized];
  return [normalized];
}

async function searchNaver(query, market) {
  const url = `https://m.stock.naver.com/front-api/search/autoComplete?query=${encodeURIComponent(query)}&target=stock`;
  try {
    const data = await httpJson(url);
    const items = data.result?.items || [];
    const wantedNation = MARKETS[market]?.nation;
    return items
      .filter((item) => item.category === "stock")
      .filter((item) => !wantedNation || item.nationCode === wantedNation)
      .map((item) => {
        const itemMarket = marketFromNation(item.nationCode);
        return {
          symbol: yahooSymbolFromNaver(item),
          rawSymbol: item.code || "",
          name: item.name || "",
          exchange: item.typeName || item.typeCode || "",
          market: itemMarket,
          currency: MARKETS[itemMarket]?.currency || "",
          source: "Naver",
        };
      });
  } catch {
    return [];
  }
}

function yahooMarketFromExchange(exchange) {
  const value = String(exchange || "").toUpperCase();
  if (["KSC", "KOE"].includes(value)) return "KR";
  if (["NMS", "NYQ", "ASE", "BTS", "PCX"].includes(value)) return "US";
  if (value === "JPX") return "JP";
  if (value === "HKG") return "HK";
  if (["SHH", "SHZ"].includes(value)) return "CN";
  return "AUTO";
}

async function searchYahoo(query, market) {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0&listsCount=0&enableFuzzyQuery=true`;
  try {
    const data = await httpJson(url);
    return (data.quotes || [])
      .filter((item) => ["EQUITY", "ETF"].includes(item.quoteType))
      .map((item) => ({ item, market: yahooMarketFromExchange(item.exchange) }))
      .filter(({ market: itemMarket }) => market === "AUTO" || itemMarket === market)
      .map(({ item, market: itemMarket }) => ({
        symbol: item.symbol || "",
        rawSymbol: item.symbol || "",
        name: item.longname || item.shortname || "",
        exchange: item.exchDisp || item.exchange || "",
        market: itemMarket,
        currency: MARKETS[itemMarket]?.currency || "",
        source: "Yahoo",
      }));
  } catch {
    return [];
  }
}

async function searchSymbols(query, market) {
  const merged = [];
  const seen = new Set();
  for (const result of [...(await searchNaver(query, market)), ...(await searchYahoo(query, market))]) {
    if (!result.symbol || seen.has(result.symbol)) continue;
    seen.add(result.symbol);
    merged.push(result);
  }
  return merged.slice(0, 12);
}

function selectDailyOrWeeklyRow(prices, dateMode, candle) {
  if (candle !== "W") {
    const index = dateMode === "PREV" ? 1 : 0;
    return prices[index] || {};
  }

  const groups = [];
  const byWeek = new Map();
  for (const row of prices) {
    const tradedDate = dateFromText(row.localTradedAt);
    if (!tradedDate) continue;
    const thursday = new Date(tradedDate);
    thursday.setUTCDate(tradedDate.getUTCDate() + 4 - (tradedDate.getUTCDay() || 7));
    const key = `${thursday.getUTCFullYear()}-${Math.ceil((((thursday - new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))) / 86400000) + 1) / 7)}`;
    if (!byWeek.has(key)) {
      byWeek.set(key, { rows: [], dates: [] });
      groups.push(byWeek.get(key));
    }
    byWeek.get(key).rows.push(row);
    byWeek.get(key).dates.push(tradedDate);
  }

  const index = dateMode === "PREV" ? 1 : 0;
  const group = groups[index];
  if (!group) return {};
  const rows = group.rows;
  const latestRow = rows[0];
  const lows = rows.map((row) => parsePrice(row.lowPrice)).filter((value) => value != null);
  const highs = rows.map((row) => parsePrice(row.highPrice)).filter((value) => value != null);
  return {
    ...latestRow,
    lowPrice: lows.length ? Math.min(...lows) : latestRow.lowPrice,
    highPrice: highs.length ? Math.max(...highs) : latestRow.highPrice,
    periodLabel: periodLabel(group.dates),
  };
}

async function fetchNaverKrxQuote(symbol, dateMode, candle) {
  const code = naverDomesticCode(symbol);
  if (!code) throw new Error("국내 종목 코드가 아닙니다.");

  const [basic, prices] = await Promise.all([
    httpJson(`https://m.stock.naver.com/api/stock/${code}/basic`),
    httpJson(`https://m.stock.naver.com/api/stock/${code}/price?pageSize=60&page=1`),
  ]);
  const latest = selectDailyOrWeeklyRow(prices, dateMode, candle);
  const exchange = basic.stockExchangeType || {};

  const price = parsePrice(latest.closePrice || basic.closePrice);
  const dayLow = parsePrice(latest.lowPrice);
  const dayHigh = parsePrice(latest.highPrice);
  if (price == null || dayLow == null || dayHigh == null) {
    throw new Error("KRX 가격 데이터를 찾을 수 없습니다.");
  }

  const suffix = exchange.code === "KQ" ? ".KQ" : ".KS";
  const periodName = candle === "W" ? "주봉" : "일봉";
  const modeName = dateMode === "PREV" ? "직전" : "최신";
  return {
    symbol: `${code}${suffix}`,
    name: basic.stockName || code,
    currency: "KRW",
    exchange: exchange.nameKor || basic.stockExchangeName || "KRX",
    price,
    dayLow,
    dayHigh,
    previousClose: null,
    timestamp: latest.localTradedAt || basic.localTradedAt,
    tradingDate: normalizeTradingDate(latest.periodLabel || latest.localTradedAt || basic.localTradedAt),
    source: `Naver/KRX ${modeName} ${periodName}`,
    dateMode,
    candle,
  };
}

async function fetchYahooKrxQuote(symbol, dateMode, candle) {
  const code = naverDomesticCode(symbol);
  const normalizedSymbol = `${code}${String(symbol).toUpperCase().endsWith(".KQ") ? ".KQ" : ".KS"}`;
  const chart =
    candle === "W"
      ? await fetchWeeklyChart(normalizedSymbol, dateMode)
      : dateMode === "PREV"
        ? await fetchDailyChartBar(normalizedSymbol, dateMode)
        : await fetchKrxLatestDailyChart(normalizedSymbol);
  const periodName = candle === "W" ? "주봉" : "일봉";
  const modeName = dateMode === "PREV" ? "직전" : "최신";
  return {
    symbol: normalizedSymbol,
    name: chart.name || code,
    currency: "KRW",
    exchange: chart.exchange || "KRX",
    price: chart.price,
    dayLow: chart.dayLow,
    dayHigh: chart.dayHigh,
    previousClose: chart.previousClose,
    timestamp: chart.timestamp,
    tradingDate: chart.tradingDate,
    source: `Yahoo Finance KRX ${modeName} ${periodName}`,
    dateMode,
    candle,
  };
}

async function fetchKrxLatestDailyChart(symbol) {
  const [dailyResult, intradayResult] = await Promise.allSettled([
    fetchDailyChartBar(symbol, "TODAY"),
    fetchIntradayChart(symbol),
  ]);

  if (dailyResult.status === "fulfilled" && intradayResult.status === "fulfilled") {
    const daily = dailyResult.value;
    const intraday = intradayResult.value;

    if (intraday.tradingDate && daily.tradingDate && intraday.tradingDate > daily.tradingDate) {
      return intraday;
    }

    if (intraday.tradingDate && daily.tradingDate && intraday.tradingDate === daily.tradingDate) {
      const lows = [daily.dayLow, intraday.dayLow].filter((value) => Number.isFinite(value) && value > 0);
      const highs = [daily.dayHigh, intraday.dayHigh].filter((value) => Number.isFinite(value) && value > 0);
      return {
        ...intraday,
        dayLow: lows.length ? Math.min(...lows) : intraday.dayLow || daily.dayLow,
        dayHigh: highs.length ? Math.max(...highs) : intraday.dayHigh || daily.dayHigh,
        previousClose: daily.previousClose ?? intraday.previousClose,
      };
    }

    return daily;
  }

  if (dailyResult.status === "fulfilled") return dailyResult.value;
  if (intradayResult.status === "fulfilled") return intradayResult.value;

  throw dailyResult.reason || intradayResult.reason || new Error("KRX price data not found.");
}

async function fetchIntradayChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
  const data = await httpJson(url);
  const result = data.chart?.result?.[0];
  if (!result) throw new Error(data.chart?.error?.description || "최신 거래일 가격 데이터를 찾을 수 없습니다.");
  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const timestamps = result.timestamp || [];
  const valid = (quote.close || [])
    .map((value, index) => ({ value, index }))
    .filter(({ value, index }) => value != null && quote.high?.[index] != null && quote.low?.[index] != null);
  if (!valid.length) throw new Error("최신 거래일 가격 데이터를 찾을 수 없습니다.");
  const latest = valid.at(-1).index;
  const lows = valid.map(({ index }) => Number(quote.low[index]));
  const highs = valid.map(({ index }) => Number(quote.high[index]));
  const timestamp = meta.regularMarketTime || timestamps[latest];
  return {
    symbol: meta.symbol || symbol,
    name: meta.longName || meta.shortName || symbol,
    currency: meta.currency || "",
    exchange: meta.fullExchangeName || meta.exchangeName || "",
    price: meta.regularMarketPrice || quote.close[latest],
    dayLow: meta.regularMarketDayLow || Math.min(...lows),
    dayHigh: meta.regularMarketDayHigh || Math.max(...highs),
    previousClose: meta.chartPreviousClose,
    timestamp,
    tradingDate: tradingDateFromTimestamp(timestamp, meta.exchangeTimezoneName),
    timezone: meta.exchangeTimezoneName,
    source: "Yahoo Finance 최신",
    dateMode: "TODAY",
    candle: "D",
  };
}

async function fetchDailyChartBar(symbol, dateMode) {
  return fetchYahooBarChart(symbol, dateMode, "D", "10d", "1d");
}

async function fetchWeeklyChart(symbol, dateMode) {
  return fetchYahooBarChart(symbol, dateMode, "W", "1y", "1wk");
}

async function fetchYahooBarChart(symbol, dateMode, candle, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const data = await httpJson(url);
  const result = data.chart?.result?.[0];
  if (!result) throw new Error(data.chart?.error?.description || "가격 데이터를 찾을 수 없습니다.");
  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const timestamps = result.timestamp || [];
  const valid = (quote.close || [])
    .map((value, index) => ({ value, index }))
    .filter(({ value, index }) => value != null && quote.high?.[index] != null && quote.low?.[index] != null);
  const selected = valid.at(dateMode === "PREV" && valid.length >= 2 ? -2 : -1);
  if (!selected) throw new Error("가격 데이터를 찾을 수 없습니다.");
  const index = selected.index;
  const timestamp = timestamps[index];
  const modeName = dateMode === "PREV" ? "직전" : "최신";
  const periodName = candle === "W" ? "주봉" : "일봉";
  return {
    symbol: meta.symbol || symbol,
    name: meta.longName || meta.shortName || symbol,
    currency: meta.currency || "",
    exchange: meta.fullExchangeName || meta.exchangeName || "",
    price: quote.close[index],
    dayLow: quote.low[index],
    dayHigh: quote.high[index],
    previousClose: valid.length >= 3 ? quote.close[valid.at(-3).index] : meta.chartPreviousClose,
    timestamp,
    tradingDate: tradingDateFromTimestamp(timestamp, meta.exchangeTimezoneName),
    timezone: meta.exchangeTimezoneName,
    source: `Yahoo Finance ${modeName} ${periodName}`,
    dateMode,
    candle,
  };
}

async function fetchChart(symbol, dateMode, candle) {
  if (candle === "W") return fetchWeeklyChart(symbol, dateMode);
  if (dateMode !== "PREV") return fetchIntradayChart(symbol);
  return fetchDailyChartBar(symbol, dateMode);
}

async function quoteSymbol(symbol, market, dateMode = "TODAY", candle = "D") {
  const normalizedDateMode = dateMode === "PREV" ? "PREV" : "TODAY";
  const normalizedCandle = candle === "W" ? "W" : "D";
  let lastError = "가격 데이터를 찾을 수 없습니다.";

  for (const candidate of normalizeSymbol(symbol, market)) {
    if (market === "KR" || naverDomesticCode(candidate)) {
      try {
        return await fetchYahooKrxQuote(candidate, normalizedDateMode, normalizedCandle);
      } catch (error) {
        lastError = error.message;
        continue;
      }
    }

    try {
      return await fetchChart(candidate, normalizedDateMode, normalizedCandle);
    } catch (error) {
      lastError = error.message;
    }
  }
  throw new Error(lastError);
}

async function latestChartPrice(symbol) {
  const data = await httpJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`);
  const result = data.chart?.result?.[0];
  if (!result) throw new Error("환율 데이터를 찾을 수 없습니다.");
  const meta = result.meta || {};
  const close = result.indicators?.quote?.[0]?.close || [];
  const price = meta.regularMarketPrice || [...close].reverse().find((value) => value != null);
  if (!price) throw new Error("환율 데이터를 찾을 수 없습니다.");
  return [Number(price), meta.regularMarketTime];
}

async function fallbackKrwRate(currency) {
  const data = await httpJson("https://open.er-api.com/v6/latest/KRW");
  const rate = data.rates?.[currency];
  if (!rate) throw new Error("환율 데이터를 찾을 수 없습니다.");
  return {
    from: "KRW",
    to: currency,
    rate: Number(rate),
    krwPerUnit: 1 / Number(rate),
    source: "open.er-api.com",
    timestamp: data.time_last_update_utc,
  };
}

async function fetchKrwRate(currency) {
  if (currency === "KRW") {
    return { from: "KRW", to: "KRW", rate: 1, krwPerUnit: 1, source: "KRW", timestamp: null };
  }
  try {
    const symbol = FX_SYMBOLS[currency];
    if (!symbol) throw new Error("Yahoo 환율 심볼이 없습니다.");
    const [krwPerUnit, timestamp] = await latestChartPrice(symbol);
    return {
      from: "KRW",
      to: currency,
      rate: 1 / krwPerUnit,
      krwPerUnit,
      source: "Yahoo Finance",
      timestamp,
    };
  } catch {
    return fallbackKrwRate(currency);
  }
}

async function convertKrw(amount, currency) {
  const fx = await fetchKrwRate(currency);
  return { ...fx, amount, convertedAmount: amount * fx.rate };
}
