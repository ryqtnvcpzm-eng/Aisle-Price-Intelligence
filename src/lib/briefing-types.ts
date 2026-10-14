/** Shape of a stored Monday Briefing (sections A–G). Shared by the builder, the database column and the page. */

export interface BriefingListing {
  variantId: string;
  familyId: string;
  name: string;
  brandName: string | null;
  isReference: boolean;
  currency: string | null;
}

export interface BriefingContent {
  week: { start: string; end: string; timeZone: string; periodStart: string; periodEnd: string };
  referenceBrand: { id: string; name: string } | null;
  /** A — summary */
  summary: { sentences: string[]; trackedListings: number; listingsObserved: number; observations: number; priceChanges: number; alertsFired: number; protectionAlerts: number };
  /** B — the reference brand's position in each managed comparison, start vs end of week */
  position: {
    groupId: string;
    name: string;
    basis: string;
    currency: string | null;
    start: PositionPoint | null;
    end: PositionPoint | null;
  }[];
  /** C — biggest week-over-week moves (start vs end of week) */
  movers: { down: BriefingMove[]; up: BriefingMove[] };
  /** D — undercuts and price leadership */
  competitive: {
    events: { id: string; type: string; headline: string; firedAt: string; isSimulated: boolean }[];
    undercutAtEnd: { groupId: string; name: string; undercutters: number; best: string | null }[];
  };
  /** E — every observed drop of 5% or more between consecutive checks */
  drops: { listing: BriefingListing; from: number; to: number; ratio: number; at: string; currency: string }[];
  /** F — daily price index (100 = start of week) for your brand vs competitors */
  trend: { day: string; reference: number | null; competitors: number | null; referenceListings: number; competitorListings: number }[];
  /** G — data confidence */
  confidence: {
    trackedListings: number;
    listingsWithObservations: number;
    coverage: number | null;
    observations: number;
    simulatedObservations: number;
    listingsWithFailures: number;
    staleAtEnd: number;
    quantities: Record<"manual" | "provider" | "parsed" | "unknown" | "missing", number>;
    notes: string[];
  };
}

export interface PositionPoint {
  referenceUnit: number | null;
  competitorMedian: number | null;
  premium: number | null;
  rank: number | null;
  comparable: number;
  cheapestBrand: string | null;
  referenceIsCheapest: boolean;
}

export interface BriefingMove {
  listing: BriefingListing;
  from: number;
  to: number;
  ratio: number;
  currency: string;
}
