import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { ListingHistory } from '@agentic-dasher/shared';
import { formatMoney } from '../money.ts';
import { t } from '../strings.ts';
import { formatTime } from '../ui.tsx';

export default function PriceChart({
  points,
  currency,
}: {
  points: ListingHistory['points'];
  currency: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    // The table retains every observation. uPlot takes one value per x coordinate.
    const at = new Map<number, number | null>();
    for (const point of points) at.set(Date.parse(point.observedAt) / 1000, point.effective);
    const css = getComputedStyle(el);
    const colour = css.getPropertyValue('--accent').trim();
    const ink = css.getPropertyValue('--muted').trim();
    const grid = { stroke: css.getPropertyValue('--border').trim(), width: 1 };
    const width = () => Math.max(1, Math.floor(el.clientWidth));
    const plot = new uPlot(
      {
        width: width(),
        height: 190,
        cursor: { drag: { x: false, y: false } },
        axes: [
          { stroke: ink, grid },
          {
            stroke: ink,
            grid,
            size: 88,
            values: (_u, values) =>
              values.map((v) => (Number.isSafeInteger(v) ? formatMoney(v, currency) : '')),
          },
        ],
        series: [
          {},
          {
            label: `${t.price} (${currency})`,
            stroke: colour,
            width: 2,
            points: { show: true, size: 5 },
            value: (_u, v) => (v == null ? t.unknown : formatMoney(v, currency)),
          },
        ],
      },
      [[...at.keys()], [...at.values()]],
      el,
    );
    const observer = new ResizeObserver(() => {
      const w = width();
      if (w !== plot.width) plot.setSize({ width: w, height: 190 });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      plot.destroy();
    };
  }, [points, currency]);
  return (
    <div className="price-chart">
      <div ref={container} aria-hidden="true" />
      <details>
        <summary>{t.historyValues}</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">{t.observedAt}</th>
              <th scope="col">
                {t.price} ({currency})
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.observationId}>
                <td>{formatTime(p.observedAt)}</td>
                <td>{p.effective === null ? t.unknown : formatMoney(p.effective, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
