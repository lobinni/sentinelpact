export type WalletState = {
  address: `0x${string}` | null;
  chainId: number | null;
  connected: boolean;
  correctNetwork: boolean;
  loading: boolean;
};

export type TxStage =
  | "idle"
  | "signing"
  | "submitted"
  | "decided"
  | "finalizing"
  | "successful"
  | "error";

export type TxState = {
  stage: TxStage;
  hash?: `0x${string}`;
  message?: string;
};

export type ReleaseRecord = {
  release_id: string;
  ecosystem: string;
  package_name: string;
  version: string;
  release_digest?: string;
  metadata_url?: string;
  publisher: string;
  warranty_count: string;
  created_at?: string;
};

export type WarrantyRecord = {
  warranty_id: string;
  release_id: string;
  package_name?: string;
  version?: string;
  publisher: string;
  title: string;
  severity_rule?: string;
  vulnerability_class?: string;
  exclusions?: string;
  bond_atto: string;
  total_coverage_atto: string;
  premium_bps: string;
  starts_at?: string;
  coverage_closes_at: string;
  ends_at: string;
  incident_window_seconds?: string;
  min_sources?: string;
  min_source_families?: string;
  evidence_bond_atto?: string;
  status: string;
  active_incident_id: string;
  incident_count?: string;
  payout_reserve_atto?: string;
  created_at?: string;
  closed_at?: string;
};

export type IncidentRecord = {
  incident_id: string;
  warranty_id: string;
  opener?: string;
  title: string;
  advisory_hint?: string;
  status: string;
  opened_at: string;
  evidence_deadline?: string;
  evidence_count?: string;
  evidence_capacity_used?: string;
  evidence_capacity_limit?: string;
  evidence_capacity_remaining?: string;
  verified_count: string;
  verified_families?: string[];
  verified_family_count?: string;
  adjudication_rounds?: string;
  adjudication_rounds_limit?: string;
  last_round_verified_count?: string;
  authoritative_families?: string;
  last_verdict: string;
  last_basis?: string;
  resolved_at?: string;
};

export type EvidenceRecord = {
  evidence_id: string;
  incident_id?: string;
  submitter: string;
  commitment?: string;
  source_family: string;
  source_url: string;
  claimed_fact: string;
  url_digest?: string;
  status: string;
  bond_atto?: string;
  committed_at?: string;
  reveal_deadline: string;
  revealed_at?: string;
  examined_at: string;
  source_available?: boolean;
  family_matches?: boolean;
  same_package?: boolean;
  material?: boolean;
  publication_in_window: boolean;
  version_discussed?: boolean;
  release_affected: boolean;
  severity_qualifies: boolean;
  class_matches: boolean;
  exclusion_applies: boolean;
  advisory_id: string;
  affected_range: string;
  basis: string;
};

export type EvidencePage = {
  items: EvidenceRecord[];
  total: string;
  offset?: string;
};

export type CoverageRecord = {
  warranty_id: string;
  holder: string;
  coverage_atto: string;
  claimed: boolean;
};

export type ProtocolStats = {
  product?: string;
  version?: string;
  network?: string;
  chain_id?: string;
  releases?: string;
  warranties?: string;
  incidents?: string;
  evidence_submissions?: string;
  total_deposited_atto?: string;
  warranty_escrow_atto?: string;
  evidence_escrow_atto?: string;
  payout_reserve_atto?: string;
  claimable_atto?: string;
  withdrawn_atto?: string;
  accounting_balanced?: boolean;
};
