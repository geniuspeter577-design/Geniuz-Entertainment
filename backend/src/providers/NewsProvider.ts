export type EntertainmentArticle = {
  id: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
};

export interface NewsProvider {
  getLatest(): Promise<EntertainmentArticle[]>;
  search(query: string): Promise<EntertainmentArticle[]>;
}

export class UnconfiguredNewsProvider implements NewsProvider {
  async getLatest(): Promise<EntertainmentArticle[]> {
    return [];
  }
  async search(_query: string): Promise<EntertainmentArticle[]> {
    return [];
  }
}
