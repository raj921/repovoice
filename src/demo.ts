import type { RepoInput } from './extract';

// An explicit, offline example. It goes through the same scanner as a real repo.
export const demoRepo: RepoInput = {
  name: 'orderbook-engine',
  description: 'A small Rust order book with a TypeScript client.',
  files: [
    { path: 'Cargo.toml', content: '[package]\nname = "orderbook-engine"\nversion = "0.1.0"\n[dependencies]\ntokio = "1"\nserde = "1"\nserde_json = "1"\n' },
    { path: 'src/order_book.rs', content: `
pub struct OrderBook { bids: Vec<PriceLevel>, asks: Vec<PriceLevel> }
pub struct PriceLevel { price: u64, quantity: u64 }
pub struct PriceLevelUpdate { level: PriceLevel, sequence: u64 }
pub enum OrderSide { Bid, Ask }
pub struct OrderBookSnapshot { levels: Vec<PriceLevel> }
impl OrderBook {
  pub fn apply_update(&mut self, update: PriceLevelUpdate) -> OrderBookSnapshot {
    let price_level: PriceLevel = update.level;
    OrderBookSnapshot { levels: vec![price_level] }
  }
  pub fn best_bid(&self) -> Option<PriceLevel> { None }
  pub fn best_ask(&self) -> Option<PriceLevel> { None }
}
pub fn publish_snapshot(snapshot: OrderBookSnapshot) { }
pub fn validate_sequence(update: PriceLevelUpdate) { }
` },
    { path: 'src/reader.rs', content: `
pub struct AlignedSbeReader { offset: usize }
pub struct MarketDataEvent { timestamp: u64 }
pub struct SequenceValidator { sequence: u64 }
pub fn decode_market_data(reader: AlignedSbeReader) -> MarketDataEvent { MarketDataEvent { timestamp: 0 } }
pub fn process_order_book(book: OrderBook, update: PriceLevelUpdate) { }
pub fn restore_snapshot(snapshot: OrderBookSnapshot) -> OrderBook { }
pub fn connect_market_stream(validator: SequenceValidator) { }
` },
    { path: 'client/package.json', content: '{"name":"orderbook-client","dependencies":{"zod":"^3","@tanstack/react-query":"^5"},"scripts":{"dev":"vite","build":"tsc && vite build","test":"vitest"}}' },
    { path: 'client/src/market-client.ts', content: `
export interface OrderBookSnapshot { levels: PriceLevel[] }
export interface PriceLevel { price: number; quantity: number }
export interface PriceLevelUpdate { level: PriceLevel; sequence: number }
export class MarketDataClient {
  subscribeOrderBook(symbol: string): OrderBookSnapshot { return { levels: [] }; }
  applyPriceLevel(update: PriceLevelUpdate): PriceLevel { return update.level; }
}
export function createMarketClient(): MarketDataClient { return new MarketDataClient(); }
export function validateSnapshot(snapshot: OrderBookSnapshot): boolean { return true; }
` },
    { path: 'README.md', content: '# Orderbook Engine\nLow-latency market data processing.\nRun cargo test to test the engine.\n' },
  ],
};
