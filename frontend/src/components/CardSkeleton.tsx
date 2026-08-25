// A shimmering placeholder shaped like a ListingCard, shown in a grid while
// listings load so the page never flashes empty. Purely decorative.
export default function CardSkeleton() {
  return (
    <div className="listing-card skeleton-card" aria-hidden="true">
      <div className="skel skel-photo" />
      <div className="card-body">
        <div className="skel skel-line" style={{ width: "38%", height: 15 }} />
        <div className="skel skel-line" style={{ width: "82%" }} />
        <div className="skel skel-line" style={{ width: "55%" }} />
      </div>
    </div>
  );
}
