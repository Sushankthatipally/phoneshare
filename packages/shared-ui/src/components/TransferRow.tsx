import type { TransferItem } from '@dropbeam/protocol';

import { cx } from '../lib/cx.js';

export function TransferRow({ item }: { item: TransferItem }) {
  const progress = Math.max(0, Math.min(100, item.progress));

  return (
    <article className="db-transfer-row">
      <div className="db-transfer-row__header">
        <div className="db-transfer-row__details">
          <strong title={item.name}>{item.name}</strong>
          <p>
            <span>{item.sizeLabel}</span>
            <span aria-hidden="true">&bull;</span>
            <span>{item.kind}</span>
          </p>
        </div>
        <span className={cx('db-transfer-row__status', `db-transfer-row__status--${item.status}`)}>
          {item.status}
        </span>
      </div>
      <div className="db-transfer-row__track">
        <div className="db-transfer-row__fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="db-transfer-row__meta">
        <span>{progress}%</span>
        <span>{item.speedLabel ?? '--'}</span>
        <span>{item.etaLabel ?? 'ready'}</span>
      </div>
    </article>
  );
}
