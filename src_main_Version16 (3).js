// MAP Violations Monitor - alerts brands when found price is below MAP on retailer sites.
// Only check authorized/public pages; respect robots.txt and ToS.
// Save MAP table in KVS (see input) as JSON { "PRODUCTID": MAP, ... }

import { Actor } from 'apify';
import { CheerioCrawler, PlaywrightCrawler, Dataset, KeyValueStore } from 'crawlee';
import fetch from 'node-fetch';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
  startUrls = [],
  mapTableKvKey = 'MAP_TABLE',
  priceSelectors = { price: ".product-price", prodId: ".sku", prodName: ".product-title" },
  maxRequestsPerCrawl = 200,
  usePlaywright = false,
  screenshot = true,
  webhookUrl = "",
  storagePrefix = "map-violations"
} = input;

const kv = await KeyValueStore.open();
const dataset = await Dataset.open();

function parsePriceText(text) {
  if (!text) return { price: null, currency: null };
  const matched = text.replace(/\u00A0/g, ' ').replace(/[,\s](?=\d{3}\b)/g, '').match(/([^\d.,\s]*)([\d,.]+)/);
  const currency = matched ? matched[1].trim() : "";
  const rawNum = matched ? matched[2].replace(/,/g,'') : "";
  const price = parseFloat(rawNum);
  return { price: Number.isFinite(price) ? price : null, currency };
}

async function postWebhook(payload) {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  } catch(e) { /* ignore */ }
}

async function runMapMonitor() {
  const mapRaw = await kv.getValue(mapTableKvKey);
  if (!mapRaw) throw new Error(`MAP table (${mapTableKvKey}) not found in KVS.`);
  let mapTable = {};
  try { mapTable = typeof mapRaw === "string" ? JSON.parse(mapRaw) : mapRaw; } catch {}
  if (!mapTable || typeof mapTable !== "object") throw new Error('Invalid MAP table!');

  const processPage = async ({$, log, page=null, request})=>{
    const url = request.loadedUrl || request.url;
    const host = (()=>{ try {return new URL(url).hostname;}catch{return"";} })();
    // Try to extract productId, name, price
    let productId = ($(priceSelectors.prodId).first().attr("data-product-id") || $(priceSelectors.prodId).first().text() || "").trim();
    let productName = ($(priceSelectors.prodName).first().text()||"").trim();
    let priceText = ($(priceSelectors.price).first().text()||"").trim();

    // fallback: look for price anywhere
    if (!priceText) priceText = $("*[class*=price]").first().text().trim();
    if (!productId) productId = $("*[class*=sku]").first().text().trim();

    const {price, currency} = parsePriceText(priceText);

    const mapPrice = productId && mapTable[productId] ? mapTable[productId] : null;
    if (!mapPrice || price == null) return; // skip if no MAP or price

    if (price < mapPrice) {
      // MAP violation detected!
      let screenshotKey = null;
      if (screenshot && page) {
        try {
          const buffer = await page.screenshot({ fullPage: false });
          const key = `${storagePrefix}/screenshots/${encodeURIComponent(host)}_${Date.now()}.png`;
          await kv.setValue(key, buffer, { contentType: 'image/png' });
          screenshotKey = key;
        } catch {}
      }
      const out = {
        retailer: host,
        productId, productName,
        foundPrice: price, mapPrice,
        currency, priceSelector: priceSelectors.price,
        listingUrl: url,
        screenshotKey,
        timestamp: new Date().toISOString()
      };
      await dataset.pushData(out);
      await postWebhook(out);
      log.info(`MAP violation: ${productName} (${productId}) at \$${price} < MAP \$${mapPrice}`, {url});
    }
  };

  if (usePlaywright) {
    const crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl,
      async requestHandler({ page, request, log }) {
        await page.waitForTimeout(1000);
        const content = await page.content();
        const $ = require('cheerio').load(content);
        await processPage({$, log, page, request});
      }
    });
    await crawler.run(startUrls);
  } else {
    const crawler = new CheerioCrawler({
      maxRequestsPerCrawl,
      async requestHandler({ $, request, log }) {
        await processPage({$, log, request});
      }
    });
    await crawler.run(startUrls);
  }
}

try { await runMapMonitor(); }
catch (e) { console.error('Actor failed', e); throw e; }
finally { await Actor.exit(); }