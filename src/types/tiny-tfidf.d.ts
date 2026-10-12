declare module "tiny-tfidf" {
  export class Corpus {
    constructor(names: string[], texts: string[], options?: { useDefaultStopwords?: boolean; customStopwords?: string[]; K1?: number; b?: number });
    getDocumentVector(identifier: string): Map<string, number>;
    getCommonTerms(identifier1: string, identifier2: string, maxTerms?: number): [string, number, number][];
    getTerms(): string[];
  }
  export class Similarity {
    constructor(corpus: Corpus);
    static cosineSimilarity(vector1: Map<string, number>, vector2: Map<string, number>): number;
  }
}
