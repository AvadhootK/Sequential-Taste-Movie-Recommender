export function RecommendationCard({ item, influencer }) {
  return (
    <div className="image-card rec-card">
      <img src={item.image_url} alt={item.category} />
      {influencer && (
        <div className="influence-badge">
          Because you liked: {influencer.category.replace(/_/g, ' ')}
        </div>
      )}
      <div className="card-footer">
        <span className="category-label">{item.category.replace(/_/g, ' ')}</span>
        <span className="distance-label">Dist: {item.distance.toFixed(3)}</span>
      </div>
    </div>
  );
}
