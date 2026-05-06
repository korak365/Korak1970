# MAP Violations Monitor - AI Agent Instructions

## Purpose

- Detect and alert on retailer listings with prices below the configured MAP.
- Only monitors public or authorized retailer web pages.

## To use

- Store your MAP table as JSON in KVS (`MAP_TABLE` or as set in input).
- Configure priceSelectors for each site if markup changes.
- Use Playwright if retailer pages are JS-heavy.
- Alerts (and dataset items) include all info to help you follow up with the retailer.

## Cautions

- Only monitor authorized or public retailer pages.
- Do not overload retailer sites or breach robots.txt/ToS.