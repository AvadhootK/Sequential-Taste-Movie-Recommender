import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from 'recharts';

function CustomTooltip({ active, payload }) {
  if (active && payload && payload.length) {
    const d = payload[0].payload;
    if (d.isPredicted) {
      return (
        <div className="chart-tooltip">
          <p>Predicted Next Direction</p>
        </div>
      );
    }
    return (
      <div className="chart-tooltip">
        <p>Step {d.step}: {d.category.replace(/_/g, ' ')}</p>
      </div>
    );
  }
  return null;
}

export function TasteTrajectoryChart({ trajectoryData, loading, error }) {
  if (loading) {
    return <div className="chart-placeholder">Computing taste trajectory...</div>;
  }
  if (error) {
    return <div className="chart-placeholder">Could not load trajectory. Is the ML service running?</div>;
  }
  if (!trajectoryData || trajectoryData.trajectory.length === 0) {
    return (
      <div className="chart-placeholder">
        <p>Like at least 2 items on the Discover page to see your taste trajectory.</p>
      </div>
    );
  }
  if (!trajectoryData.has_enough_data) {
    return (
      <div className="chart-placeholder">
        <p>Like one more item to unlock your taste trajectory chart.</p>
      </div>
    );
  }

  const { trajectory, predicted_next } = trajectoryData;
  const n = trajectory.length;

  const historyPoints = trajectory.map((p, idx) => ({
    x: p.x,
    y: p.y,
    step: p.step,
    category: p.category,
    isCurrent: idx === n - 1,
  }));

  const predictionPoints = predicted_next
    ? [{ x: predicted_next.x, y: predicted_next.y, isPredicted: true }]
    : [];

  return (
    <div className="trajectory-chart-container">
      <ResponsiveContainer width="100%" height={420}>
        <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
          <XAxis type="number" dataKey="x" name="Taste Dim 1" tick={false} axisLine={false} label={{ value: 'Aesthetic Dimension 1', position: 'insideBottom', offset: -10, fill: '#999', fontSize: 12 }} />
          <YAxis type="number" dataKey="y" name="Taste Dim 2" tick={false} axisLine={false} label={{ value: 'Aesthetic Dimension 2', angle: -90, position: 'insideLeft', fill: '#999', fontSize: 12 }} />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<CustomTooltip />} />
          <Scatter name="Taste Journey" data={historyPoints} isAnimationActive={true}>
            {historyPoints.map((entry, index) => (
              <Cell
                key={index}
                fill={entry.isCurrent ? '#f59e0b' : '#6366f1'}
                r={entry.isCurrent ? 10 : 7}
              />
            ))}
          </Scatter>
          {predictionPoints.length > 0 && (
            <Scatter
              name="Predicted Next"
              data={predictionPoints}
              fill="#10b981"
              shape="star"
              isAnimationActive={true}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
      <div className="trajectory-legend">
        <span className="legend-item"><span className="dot past"></span> Past taste positions</span>
        <span className="legend-item"><span className="dot current"></span> Current taste</span>
        {predicted_next && (
          <span className="legend-item"><span className="dot predicted"></span> Predicted direction</span>
        )}
      </div>
    </div>
  );
}
