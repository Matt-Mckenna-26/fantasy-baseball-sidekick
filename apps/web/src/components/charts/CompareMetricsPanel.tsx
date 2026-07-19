import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { StatColumn } from '@fcm/contracts';
import {
  buildCompareTileExports,
  downloadCompareChartPng,
} from '../../lib/chartExport';
import { CompareEntityTiles } from './CompareEntityTiles';
import type { CompareEntity } from './compareEntity';
import { MetricsGroupedChart } from './MetricsGroupedChart';
import { ChartDownloadButton } from './ChartDownloadButton';
import styles from './charts.module.css';

/**
 * Grouped compare chart plus per-entity stat tiles, with PNG export of the full
 * visible block (chart on top, reference cards below) matching the trend chart UX.
 */
export const CompareMetricsPanel = memo(function CompareMetricsPanel({
  entities,
  columns,
  percentiles,
  ranks,
  exportTitle,
  exportSubtitle,
  exportFilename,
}: {
  entities: CompareEntity[];
  columns: ReadonlyArray<StatColumn>;
  percentiles: Map<string, (value: number) => number>;
  ranks: Map<string, (value: number) => { rank: number; total: number }>;
  exportTitle: string;
  exportSubtitle: string;
  exportFilename: string;
}) {
  const [exporting, setExporting] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  const tileExports = useMemo(
    () => buildCompareTileExports(entities, columns, percentiles, ranks),
    [entities, columns, percentiles, ranks],
  );

  const handleExport = useCallback(async () => {
    if (!chartRef.current || exporting) return;
    setExporting(true);
    try {
      await downloadCompareChartPng({
        chartRoot: chartRef.current,
        title: exportTitle,
        subtitle: exportSubtitle,
        tiles: tileExports,
        filename: exportFilename,
      });
    } catch (err) {
      console.error('PNG export failed', err);
    } finally {
      setExporting(false);
    }
  }, [exportFilename, exportSubtitle, exportTitle, exporting, tileExports]);

  return (
    <div className={styles.trendChartWrap}>
      <div className={styles.trendChartActions}>
        <ChartDownloadButton
          onClick={() => void handleExport()}
          busy={exporting}
        />
      </div>
      <div ref={chartRef}>
        <MetricsGroupedChart entities={entities} columns={columns} percentiles={percentiles} />
        <CompareEntityTiles
          entities={entities}
          columns={columns}
          percentiles={percentiles}
          ranks={ranks}
        />
      </div>
    </div>
  );
});
