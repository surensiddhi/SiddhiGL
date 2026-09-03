/** party.ts — mirrors Partyservice.js */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';
import type { Party } from '../types';

export const listParties = (includeInactive = false, partyType?: string) =>
  rpc<Party[]>('list_parties', {
    ...ctx(),
    p_include_inactive: includeInactive,
    p_party_type: partyType ?? null
  });

export const saveParty = (party: Party) =>
  rpc('save_party', { ...ctx(), ...party });

export const deleteParty = (partyCode: string, partyType: string) =>
  rpc('delete_party', { ...ctx(), p_party_code: partyCode, p_party_type: partyType });

export const nextPartyCode = (partyType: string) =>
  rpc<string>('next_party_code', { ...ctx(), p_party_type: partyType });
