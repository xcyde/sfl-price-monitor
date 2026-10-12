export interface SflPricesApiResponse {
  data: {
    p2p: Record<string, number>;
    seq: Record<string, number>;
    ge: Record<string, number>;
  };
  updatedAt: number;
  updated_text: string;
}

export interface PriceEntry {
  itemName: string;
  price: number;
  fetchedAt: Date;
}

export interface NftEntry {
  collection: string;
  externalId: number;
  name: string | null;
  boostText: string | null;
  floor: number;
  lastSalePrice: number;
  supply: number;
}
