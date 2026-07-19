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
