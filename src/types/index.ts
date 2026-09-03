/** Shared TypeScript interfaces for SiddhiGL */

export interface VoucherHead {
  head_id?:     number;
  tran_type:    string;
  tran_date:    string; // YYYY-MM-DD (English ISO)
  narration?:   string;
  ref_no?:      string;
  cost_centre?: string;
}

export interface VoucherLine {
  line_id?:     number;
  account_no:   string;
  dr_amount:    number;
  cr_amount:    number;
  narration?:   string;
  party_type?:  string;
  party_code?:  string;
  cost_centre?: string;
}

export interface Account {
  account_no:      string;
  name:            string;
  acc_type:        string;
  parent_no?:      string;
  active:          boolean;
  requires_party?: boolean;
  opening_dr?:     number;
  opening_cr?:     number;
}

export interface AccountType {
  acc_type:     string;
  acc_type_desc: string;
  acc_class:    string;
  acc_group?:   string;
  tran_level:   boolean;
  active:       boolean;
}

export interface Party {
  party_code:         string;
  party_name:         string;
  party_type:         string;
  control_account_no: string;
  active:             boolean;
  address?:           string;
  phone?:             string;
  email?:             string;
  pan_no?:            string;
}

export interface CostCentre {
  code:   string;
  name:   string;
  active: boolean;
}

export interface LookupRow {
  value: string;
  label: string;
  row:   Record<string, unknown>;
}

export interface LookupResult {
  columns:     string[];
  valueColumn: string;
  labelColumn: string;
  clientCache: boolean;
  rows:        LookupRow[];
}

export interface MenuItem {
  menu_id:   number;
  parent_id: number | null;
  label:     string;
  view_key:  string | null;
  icon?:     string;
  sort_order: number;
  min_role:  number;
}

export interface CompanyConfig {
  company_name:      string;
  address?:          string;
  pan_no?:           string;
  phone?:            string;
  email?:            string;
  fiscal_year_start: string;
  business_type:     'service' | 'trading';
  age_b1?:           number;
  age_b2?:           number;
  age_b3?:           number;
  age_b4?:           number;
  lock_date?:        string;
}
