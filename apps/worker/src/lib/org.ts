/**
 * プロラボ独自: 4階層ロール解決
 * 経営層(exec) / エリアマネージャー(area) / 店長(store) / 現場(field)
 * OSSの role(owner/admin/staff)とは別に org_scopes で階層を持つ。
 */
export type Layer = 'exec' | 'area' | 'store' | 'field';

export interface OrgScope {
  layer: Layer;
  areaId: string | null;
  storeIds: string[]; // アクセス可能な店舗(OA) id
  allStores: boolean;
}

export const LAYER_LABEL: Record<Layer, string> = {
  exec: '経営層',
  area: 'エリアマネージャー',
  store: '店長',
  field: '現場',
};

export async function resolveOrg(
  db: D1Database,
  staff: { id?: string; role?: string } | undefined,
): Promise<OrgScope> {
  const id = staff?.id;
  const role = staff?.role;
  let layer: Layer | null = null;
  let areaId: string | null = null;

  if (id) {
    const row = await db
      .prepare(`SELECT layer, area_id FROM org_scopes WHERE staff_id = ?`)
      .bind(id)
      .first<{ layer: Layer; area_id: string | null }>();
    if (row) {
      layer = row.layer;
      areaId = row.area_id;
    }
  }
  // 明示スコープが無ければ: owner/admin は経営層、それ以外は現場
  if (!layer) layer = role === 'owner' || role === 'admin' ? 'exec' : 'field';

  if (layer === 'exec') {
    const r = await db.prepare(`SELECT id FROM line_accounts WHERE is_active = 1`).all<{ id: string }>();
    return { layer, areaId: null, storeIds: (r.results ?? []).map((x) => x.id), allStores: true };
  }
  if (layer === 'area') {
    const r = await db
      .prepare(`SELECT id FROM line_accounts WHERE is_active = 1 AND area_id = ?`)
      .bind(areaId)
      .all<{ id: string }>();
    return { layer, areaId, storeIds: (r.results ?? []).map((x) => x.id), allStores: false };
  }
  // store / field → 割当店舗
  const r = await db
    .prepare(`SELECT line_account_id AS id FROM staff_store_assignments WHERE staff_id = ?`)
    .bind(id ?? '')
    .all<{ id: string }>();
  return { layer, areaId, storeIds: (r.results ?? []).map((x) => x.id), allStores: false };
}

/** 起案できる配信スコープ */
export function proposableScopes(layer: Layer): Array<'all' | 'area' | 'store'> {
  switch (layer) {
    case 'exec': return ['all', 'area', 'store'];
    case 'area': return ['area', 'store'];
    case 'store': return ['store'];
    default: return [];
  }
}
